import ndk from './ndk'
import { NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk'

// Fetch kind-7 reactions for an event from the local Dexie cache only.
// No relay round-trip — fast enough to call on every visible post at mount.
export function fetchReactionsFromCache(eventId) {
  return new Promise((resolve) => {
    const events = new Map()
    const sub = ndk.subscribe(
      { kinds: [7], '#e': [eventId] },
      {
        closeOnEose: true,
        groupable: false,
        cacheUsage: NDKSubscriptionCacheUsage.ONLY_CACHE,
      }
    )
    sub.on('event', (e) => {
      if (e.id && e.pubkey) events.set(e.id, { id: e.id, pubkey: e.pubkey, content: e.content || '+' })
    })
    sub.on('eose', () => resolve([...events.values()]))
    // Dexie resolves eose immediately; safety timeout in case it doesn't
    setTimeout(() => resolve([...events.values()]), 300)
  })
}
