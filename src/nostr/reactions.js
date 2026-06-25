import ndk from './ndk'
import { NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk'

const CACHE_ONLY = { closeOnEose: true, groupable: false, cacheUsage: NDKSubscriptionCacheUsage.ONLY_CACHE }

// Fetch kind-7 reactions for an event from the local Dexie cache only.
// No relay round-trip — fast enough to call on every visible post at mount.
export function fetchReactionsFromCache(eventId) {
  return new Promise((resolve) => {
    const events = new Map()
    const sub = ndk.subscribe({ kinds: [7], '#e': [eventId] }, CACHE_ONLY)
    sub.on('event', (e) => {
      if (e.id && e.pubkey) events.set(e.id, { id: e.id, pubkey: e.pubkey, content: e.content || '+' })
    })
    sub.on('eose', () => resolve([...events.values()]))
    setTimeout(() => resolve([...events.values()]), 300)
  })
}

// Fetch kind-9735 zap receipts for an event. Hits cache + relays in parallel
// so the count appears even when receipts aren't in the local Dexie cache.
// Groupable so NDK batches all visible-post queries into one relay request.
export function fetchZapTotalFromCache(eventId) {
  return new Promise((resolve) => {
    let msats = 0
    const sub = ndk.subscribe(
      { kinds: [9735], '#e': [eventId] },
      {
        closeOnEose: true,
        groupable: true,
        groupableDelay: 200,
        cacheUsage: NDKSubscriptionCacheUsage.PARALLEL,
      }
    )
    sub.on('event', (e) => {
      const amtTag = (e.tags || []).find(t => t[0] === 'amount')
      if (amtTag?.[1]) msats += parseInt(amtTag[1], 10) || 0
    })
    sub.on('eose', () => resolve(Math.floor(msats / 1000)))
    setTimeout(() => resolve(Math.floor(msats / 1000)), 3000)
  })
}
