// NIP-57 zaps + LNURL-pay invoice fetching.
//
// Given a recipient's lnurl (astral's profileLud06 getter always yields an
// lnurl bech32), this resolves the LNURL-pay endpoint and returns a payable
// bolt11 invoice. When the endpoint advertises Nostr support (allowsNostr +
// nostrPubkey) and the user is logged in, it attaches a signed kind-9734 zap
// request so the payment produces a proper zap receipt (kind 9735); otherwise
// it falls back to a plain LNURL tip.

import { bech32 } from '@scure/base'
import { signAsynchronously } from '../utils/event'

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
  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not fetch invoice (${res.status})`)
  const data = await res.json()
  if (data.status === 'ERROR') throw new Error(data.reason || 'invoice error')
  if (!data.pr) throw new Error('no invoice returned')
  return data.pr
}

// Build and sign a NIP-57 kind-9734 zap request.
export async function buildZapRequest({
  store,
  recipientPubkey,
  amountSats,
  comment = '',
  eventId,
  lnurl,
  relays
}) {
  const tags = [
    ['relays', ...relays],
    ['amount', String(amountSats * 1000)],
    ['p', recipientPubkey]
  ]
  if (lnurl) tags.push(['lnurl', lnurl])
  if (eventId) tags.push(['e', eventId])

  const event = {
    kind: 9734,
    content: comment || '',
    tags,
    pubkey: store.state.keys.pub,
    created_at: Math.round(Date.now() / 1000)
  }
  return signAsynchronously(event, store)
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

  const canZap = meta.allowsNostr && meta.nostrPubkey && recipientPubkey && store?.state?.keys?.pub
  if (canZap) {
    const zapRelays = relays.length
      ? relays
      : Object.keys(store.state.relays).length
        ? Object.keys(store.state.relays)
        : Object.keys(store.state.defaultRelays)
    const zapReq = await buildZapRequest({
      store,
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

  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not fetch invoice (${res.status})`)
  const data = await res.json()
  if (data.status === 'ERROR') throw new Error(data.reason || 'invoice error')
  if (!data.pr) throw new Error('no invoice returned')
  return data.pr
}
