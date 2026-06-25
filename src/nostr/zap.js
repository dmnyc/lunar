// NIP-57 zaps + LNURL-pay invoice fetching.
//
// Given a recipient's lnurl (astral's profileLud06 getter always yields an
// lnurl bech32), this resolves the LNURL-pay endpoint and returns a payable
// bolt11 invoice. When the endpoint advertises Nostr support (allowsNostr +
// nostrPubkey) and the user is logged in, it attaches a signed kind-9734 zap
// request so the payment produces a proper zap receipt (kind 9735); otherwise
// it falls back to a plain LNURL tip.

import { bech32 } from '@scure/base'
import ndk from './ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'

function lnurlToUrl(lnurl) {
  const s = lnurl.trim()
  if (/^https?:\/\//i.test(s)) return s
  // Lightning address: name@domain → LNURL-pay well-known endpoint
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
    const [name, domain] = s.split('@')
    return `https://${domain}/.well-known/lnurlp/${name}`
  }
  // lnurl bech32
  const { words } = bech32.decode(s, 2000)
  const bytes = bech32.fromWords(words)
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

async function fetchLnurlPayMetadata(lnString) {
  const res = await fetch(lnurlToUrl(lnString))
  if (!res.ok) throw new Error(`could not resolve lightning endpoint (${res.status})`)
  const data = await res.json()
  if (data.status === 'ERROR') throw new Error(data.reason || 'lightning endpoint error')
  if (!data.callback) throw new Error('lightning endpoint missing callback')
  return data // { callback, minSendable, maxSendable, allowsNostr, nostrPubkey, commentAllowed }
}

async function fetchInvoiceFromUrl(url) {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const reason = body?.reason || body?.message || ''
    throw new Error(`could not fetch invoice (${res.status})${reason ? ': ' + reason : ''}`)
  }
  const data = await res.json()
  if (data.status === 'ERROR') throw new Error(data.reason || 'invoice error')
  if (!data.pr) throw new Error('no invoice returned')
  return data.pr
}

// Resolve a lightning address / LNURL into a plain bolt11 invoice (no zap
// request) — used by the wallet "send" flow.
export async function fetchLnurlInvoice(lnStringOrAddress, amountSats, comment = '') {
  if (!amountSats || amountSats <= 0) throw new Error('amount required')
  const meta = await fetchLnurlPayMetadata(lnStringOrAddress)
  const amountMsats = amountSats * 1000
  if (meta.minSendable && amountMsats < meta.minSendable) {
    throw new Error(`minimum is ${Math.ceil(meta.minSendable / 1000)} sats`)
  }
  if (meta.maxSendable && amountMsats > meta.maxSendable) {
    throw new Error(`maximum is ${Math.floor(meta.maxSendable / 1000)} sats`)
  }
  let url = `${meta.callback}${meta.callback.includes('?') ? '&' : '?'}amount=${amountMsats}`
  if (comment && meta.commentAllowed) url += `&comment=${encodeURIComponent(comment.slice(0, meta.commentAllowed))}`
  return fetchInvoiceFromUrl(url)
}

// Build and sign a NIP-57 kind-9734 zap request using NDKEvent so NDK's
// canonical ID computation and signer path are used (matches zapcooking).
export async function buildZapRequest({
  recipientPubkey,
  amountSats,
  comment = '',
  eventId,
  lnurl,
  relays
}) {
  const zapRequest = new NDKEvent(ndk)
  zapRequest.kind = 9734
  zapRequest.content = comment || ''
  zapRequest.tags = [
    ['p', recipientPubkey],
    ['amount', String(amountSats * 1000)],
    ['relays', ...relays],
  ]
  if (lnurl) zapRequest.tags.push(['lnurl', lnurl])
  if (eventId) zapRequest.tags.push(['e', eventId])

  await zapRequest.sign()
  return zapRequest.rawEvent()
}

// Resolve an lnurl + amount into a payable bolt11 invoice. Attaches a zap
// request when possible. `recipientPubkey` enables the NIP-57 path; omit it
// (or stay logged out) for a plain LNURL tip.
export async function fetchZapInvoice({
  store,
  lnString,
  recipientPubkey,
  amountSats,
  comment = '',
  eventId,
  relays = []
}) {
  if (!amountSats || amountSats <= 0) throw new Error('amount required')

  const meta = await fetchLnurlPayMetadata(lnString)
  const amountMsats = amountSats * 1000
  if (meta.minSendable && amountMsats < meta.minSendable) {
    throw new Error(`minimum is ${Math.ceil(meta.minSendable / 1000)} sats`)
  }
  if (meta.maxSendable && amountMsats > meta.maxSendable) {
    throw new Error(`maximum is ${Math.floor(meta.maxSendable / 1000)} sats`)
  }

  let url = `${meta.callback}${meta.callback.includes('?') ? '&' : '?'}amount=${amountMsats}`

  const canZap = meta.allowsNostr && meta.nostrPubkey && recipientPubkey && ndk.signer
  if (canZap) {
    // Prefer live connected relays so zap receipts land somewhere reachable.
    // Fall back to the store relay list, then the NDK explicit set.
    const connectedUrls = ndk.pool.connectedRelays().map(r => r.url)
    const zapRelays = relays.length
      ? relays
      : connectedUrls.length
        ? connectedUrls
        : store
          ? Object.keys(store.state.relays).length
            ? Object.keys(store.state.relays)
            : Object.keys(store.state.defaultRelays)
          : ndk.explicitRelayUrls || []
    const zapReq = await buildZapRequest({
      recipientPubkey,
      amountSats,
      comment,
      eventId,
      lnurl: lnString,
      relays: zapRelays
    })
    url += `&nostr=${encodeURIComponent(JSON.stringify(zapReq))}`
    url += `&lnurl=${encodeURIComponent(lnString)}`
  } else if (comment && meta.commentAllowed) {
    url += `&comment=${encodeURIComponent(comment.slice(0, meta.commentAllowed))}`
  }

  return fetchInvoiceFromUrl(url)
}
