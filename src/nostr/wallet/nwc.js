// NWC (Nostr Wallet Connect / NIP-47) over NDK.
//
// Implements NIP-47 directly on the app's NDK instance (kind 23194 request /
// 23195 response, NIP-04 encrypted) rather than via a separate SDK + relay
// pool. Ported from zapcooking src/lib/wallet/nwc.ts.

import ndk, { connect } from '../ndk'
import { NDKEvent, NDKPrivateKeySigner, NDKRelay, NDKRelaySet } from '@nostr-dev-kit/ndk'
import { nip04, nip19, getPublicKey as nostrGetPublicKey } from 'nostr-tools'
import { hexToBytes } from '@noble/hashes/utils'

let nwcRelay = null
let nwcSecret = null
let nwcWalletPubkey = null
let currentConnectionUrl = null
let pendingBalanceRequest = null
let connectionInProgress = null

// Parse nostr+walletconnect://pubkey?relay=wss://...&secret=...&lud16=...
export function parseNwcUrl(url) {
  try {
    const cleanedInput = url.trim().replace(/[\r\n\t]/g, '')
    if (
      !/^nostr(?:\+walletconnect)?:\/\//i.test(cleanedInput) &&
      !/^nostrwalletconnect:/i.test(cleanedInput)
    ) {
      return null
    }
    const cleaned = cleanedInput
      .replace(/^nostr\+walletconnect:\/\//i, '')
      .replace(/^nostrwalletconnect:\/\//i, '')
      .replace(/^nostr\+walletconnect:/i, '')
      .replace(/^nostrwalletconnect:/i, '')

    const [pubkey, queryString] = cleaned.split('?')
    if (!pubkey || !queryString) return null

    const params = new URLSearchParams(queryString)
    const relay = params.get('relay')?.trim()
    const secret = params.get('secret')?.trim()
    const lud16 = params.get('lud16')?.trim() || undefined
    if (!relay || !secret) return null

    const normalizedPubkey = normalizePubkey(pubkey.trim())
    if (!/^[0-9a-fA-F]{64}$/.test(normalizedPubkey)) return null

    return { pubkey: normalizedPubkey, relay, secret, lud16 }
  } catch (e) {
    console.error('[NWC] Failed to parse connection URL:', e)
    return null
  }
}

export function isValidNwcUrl(url) {
  return parseNwcUrl(url) !== null
}

function normalizePubkey(pubkey) {
  const cleaned = pubkey.trim()
  if (cleaned.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(cleaned)
      if (decoded.type === 'npub') return decoded.data
    } catch (e) {
      console.error('[NWC] Failed to decode npub:', e)
    }
  }
  return cleaned
}

function normalizeSecretKey(secret) {
  let cleaned = secret.trim()
  if (cleaned.startsWith('nsec')) {
    const decoded = nip19.decode(cleaned)
    if (decoded.type === 'nsec') {
      return Array.from(decoded.data)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }
  }
  if (/^[0-9a-fA-F]{64}$/.test(cleaned)) return cleaned
  if (cleaned.length === 65 && /^[0-9a-fA-F]{64}/.test(cleaned)) return cleaned.slice(0, 64)
  const hexMatch = cleaned.match(/[0-9a-fA-F]{64}/)
  if (hexMatch) return hexMatch[0]
  return cleaned
}

function clientPubkeyFromSecret(secret) {
  return nostrGetPublicKey(hexToBytes(normalizeSecretKey(secret)))
}

export async function connectNwc(connectionUrl) {
  await connect()

  if (
    currentConnectionUrl === connectionUrl &&
    nwcSecret !== null &&
    nwcWalletPubkey !== null &&
    nwcRelay?.status === 1
  ) {
    return true
  }
  if (connectionInProgress) return connectionInProgress

  connectionInProgress = (async () => {
    try {
      const parsed = parseNwcUrl(connectionUrl)
      if (!parsed) throw new Error('Invalid NWC connection URL')

      nwcSecret = parsed.secret
      nwcWalletPubkey = parsed.pubkey
      currentConnectionUrl = connectionUrl

      let relayUrl = parsed.relay
      if (!relayUrl.endsWith('/')) relayUrl = relayUrl + '/'

      for (const relay of ndk.pool.relays.values()) {
        if (relay.url === relayUrl) {
          try {
            relay.disconnect()
          } catch (_) {
            /* ignore */
          }
          ndk.pool.removeRelay(relayUrl)
          await new Promise((r) => setTimeout(r, 100))
          break
        }
      }

      nwcRelay = new NDKRelay(relayUrl, undefined, ndk)
      await waitForRelayConnection(nwcRelay, 15000)
      return true
    } catch (e) {
      console.error('[NWC] Connection failed:', e)
      nwcRelay = null
      nwcSecret = null
      nwcWalletPubkey = null
      currentConnectionUrl = null
      throw e
    } finally {
      connectionInProgress = null
    }
  })()

  return connectionInProgress
}

function waitForRelayConnection(relay, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (relay.status === 1) {
      resolve()
      return
    }
    let connectTimeout
    const cleanup = () => {
      clearTimeout(connectTimeout)
      relay.off('connect', onConnect)
      relay.off('disconnect', onDisconnect)
    }
    const onConnect = () => {
      cleanup()
      resolve()
    }
    const onDisconnect = () => {
      cleanup()
      reject(new Error('Relay disconnected before connection established'))
    }
    connectTimeout = setTimeout(() => {
      cleanup()
      reject(new Error('Relay connection timeout'))
    }, timeoutMs)
    relay.on('connect', onConnect)
    relay.on('disconnect', onDisconnect)
    relay.connect()
  })
}

export async function disconnectNwc() {
  if (nwcRelay) {
    const relayUrl = nwcRelay.url
    try {
      nwcRelay.disconnect()
    } catch (_) {
      /* ignore */
    }
    try {
      ndk.pool.removeRelay(relayUrl)
    } catch (_) {
      /* ignore */
    }
  }
  nwcRelay = null
  nwcSecret = null
  nwcWalletPubkey = null
  currentConnectionUrl = null
}

export function isNwcConnected() {
  return nwcSecret !== null && nwcWalletPubkey !== null && nwcRelay?.status === 1
}

async function executeNip47Request(method, params = {}) {
  if (!nwcSecret || !nwcWalletPubkey || !nwcRelay) throw new Error('NWC not connected')

  const secretHex = normalizeSecretKey(nwcSecret)
  const clientPubkey = clientPubkeyFromSecret(nwcSecret)
  const content = JSON.stringify({ method, params })
  const encryptedContent = await nip04.encrypt(secretHex, nwcWalletPubkey, content)

  const event = new NDKEvent(ndk)
  event.kind = 23194
  event.content = encryptedContent
  event.tags = [['p', nwcWalletPubkey]]
  event.pubkey = clientPubkey
  await event.sign(new NDKPrivateKeySigner(secretHex))

  const relaySet = new NDKRelaySet(new Set([nwcRelay]), ndk)
  const sub = ndk.subscribe(
    { kinds: [23195], authors: [nwcWalletPubkey], '#p': [clientPubkey], '#e': [event.id] },
    { closeOnEose: false },
    relaySet
  )

  const responsePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      sub.stop()
      reject(new Error('NWC request timeout'))
    }, 10000)
    sub.on('event', async (responseEvent) => {
      try {
        clearTimeout(timeout)
        sub.stop()
        const decrypted = await nip04.decrypt(secretHex, nwcWalletPubkey, responseEvent.content)
        const response = JSON.parse(decrypted)
        if (response.error) reject(new Error(response.error.message || 'NWC error'))
        else resolve(response.result)
      } catch (e) {
        clearTimeout(timeout)
        sub.stop()
        reject(e)
      }
    })
  })

  await new Promise((r) => setTimeout(r, 100))
  await event.publish(relaySet)
  return responsePromise
}

export async function getNwcBalance(retries = 3) {
  if (!isNwcConnected()) throw new Error('NWC not connected')
  if (pendingBalanceRequest) return pendingBalanceRequest

  const fetchBalance = async () => {
    let lastError = null
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await executeNip47Request('get_balance')
        return Math.floor((result.balance || 0) / 1000)
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e))
        if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * attempt))
      }
    }
    throw lastError || new Error('Failed to get NWC balance')
  }

  pendingBalanceRequest = fetchBalance()
  try {
    return await pendingBalanceRequest
  } finally {
    pendingBalanceRequest = null
  }
}

export async function payNwcInvoice(invoice) {
  if (!isNwcConnected()) throw new Error('NWC not connected')
  const result = await executeNip47Request('pay_invoice', { invoice })
  return { preimage: result.preimage }
}

export async function createNwcInvoice(amountSats, description) {
  if (!isNwcConnected()) throw new Error('NWC not connected')
  const result = await executeNip47Request('make_invoice', {
    amount: amountSats * 1000,
    description: description || 'lunar payment'
  })
  return { invoice: result.invoice, paymentHash: result.payment_hash }
}

export async function getNwcInfo() {
  if (!isNwcConnected()) throw new Error('NWC not connected')
  const result = await executeNip47Request('get_info')
  return { alias: result.alias, methods: result.methods || [] }
}

export async function listNwcTransactions(options = {}) {
  if (!isNwcConnected()) throw new Error('NWC not connected')
  const params = {}
  if (options.limit) params.limit = options.limit
  if (options.from) params.from = options.from
  if (options.until) params.until = options.until
  const result = await executeNip47Request('list_transactions', params)
  return (result.transactions || []).map((tx) => ({
    type: tx.type, // 'incoming' | 'outgoing'
    description: tx.description,
    amount: Math.floor((tx.amount || 0) / 1000), // msats → sats
    feesPaid: Math.floor((tx.fees_paid || 0) / 1000),
    createdAt: tx.created_at,
    settledAt: tx.settled_at,
    paymentHash: tx.payment_hash
  }))
}

export function getNwcDisplayName(connectionUrl) {
  const parsed = parseNwcUrl(connectionUrl)
  if (!parsed) return 'NWC Wallet'
  return parsed.lud16 || `NWC (${parsed.pubkey.slice(0, 8)}…)`
}
