// NDK singleton — the modern nostr core that replaces the hand-rolled
// relay/db/query Web Worker pool (relay.worker.js + sql.js). One NDK instance
// owns relay connections, an IndexedDB (Dexie) cache, and the active signer.
//
// Ported from the zapcooking nostr.ts pattern, trimmed for astral.

import NDK, { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk'
import NDKCacheAdapterDexie from '@nostr-dev-kit/ndk-cache-dexie'
import { LocalStorage } from 'quasar'

// Sensible, currently-alive default relays. The 2022 list in store/state.js is
// mostly dead; these are the broadly-reachable relays the rest of the nostr
// ecosystem leans on today.
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://offchain.pub'
]

// Outbox/discovery relays used for resolving profiles and relay lists.
const OUTBOX_RELAYS = ['wss://purplepag.es', 'wss://relay.nostr.band']

function storedRelayUrls() {
  // The legacy Vuex layer persists relays as { [url]: {read, write} }.
  const relays = LocalStorage.getItem('relays')
  if (relays && typeof relays === 'object') {
    const urls = Object.keys(relays).filter((u) => /^wss?:\/\//.test(u))
    if (urls.length) return urls
  }
  return DEFAULT_RELAYS
}

const cacheAdapter =
  typeof indexedDB !== 'undefined'
    ? new NDKCacheAdapterDexie({ dbName: 'astral-ndk-cache' })
    : undefined

const ndk = new NDK({
  explicitRelayUrls: storedRelayUrls(),
  outboxRelayUrls: OUTBOX_RELAYS,
  enableOutboxModel: true,
  autoConnectUserRelays: true,
  autoFetchUserMutelist: false,
  cacheAdapter
})

let connectPromise = null

// Connect once; subsequent callers await the same promise. NDK keeps relay
// connections alive and reconnects on its own afterward.
export function connect() {
  if (!connectPromise) {
    connectPromise = ndk.connect(2500).catch((err) => {
      console.error('[ndk] connect failed', err)
    })
  }
  return connectPromise
}

// Add relays to the live pool (e.g. the user's NIP-65 set) so subsequent
// subscriptions and publishes can use them.
export function addRelays(urls = []) {
  for (const url of urls) {
    if (!/^wss?:\/\//.test(url)) continue
    try {
      ndk.addExplicitRelay(url)
    } catch (err) {
      console.warn('[ndk] could not add relay', url, err)
    }
  }
}

// Build an NDKRelaySet from explicit URLs (used when callers pass a relays list,
// mirroring the old worker API), falling back to the pool's default set.
export function relaySetFrom(urls) {
  if (urls && urls.length) {
    return NDKRelaySet.fromRelayUrls(urls, ndk)
  }
  return undefined
}

export { ndk, NDKEvent }
export default ndk
