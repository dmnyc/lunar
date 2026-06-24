// NDK-backed reimplementation of the old worker query facade.
//
// The original query.js spawned query.worker.js (which drove relay.worker.js +
// a sql.js cache over a MessageChannel). This module keeps the exact same
// exported surface — same function names, argument shapes, return contracts,
// and the { update, cancel } stream handle — but services everything through
// the single NDK instance in src/nostr/ndk.js. That lets the legacy Vuex store
// and all existing components keep working unchanged while the data layer is
// modernized underneath them.
//
// Contracts preserved from the worker API:
//   - call-style fns resolve to an array of plain events (or a single
//     event / number where the old code expected that).
//   - stream-style fns take (settings, cb, eoseCb), invoke cb with an ARRAY of
//     events per emission, eoseCb once on EOSE, and return { update, cancel }.

import { NDKRelaySet, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk'
import ndk, { connect, NDKEvent } from './nostr/ndk'

const now = () => Math.round(Date.now() / 1000)

function toRaw(ndkEvent) {
  return ndkEvent.rawEvent ? ndkEvent.rawEvent() : ndkEvent
}

function relaySet(relays) {
  if (relays && relays.length) {
    try {
      return NDKRelaySet.fromRelayUrls(relays, ndk)
    } catch (_) {
      return undefined
    }
  }
  return undefined
}

// Collect events from a one-shot subscription, resolving on EOSE OR after a
// timeout. NDK 2.10's fetchEvents() can hang indefinitely for some filters
// (notably tag filters like #p) when a relay never sends EOSE, which left pages
// like Notifications blank. Driving the subscription ourselves guarantees the
// promise always settles with whatever arrived.
function collect(filter, relays, { timeout = 4000, cacheUsage = NDKSubscriptionCacheUsage.CACHE_FIRST } = {}) {
  return new Promise((resolve) => {
    const events = new Map()
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        sub.stop()
      } catch (_) {
        /* already stopped */
      }
      resolve([...events.values()])
    }
    const sub = ndk.subscribe(
      filter,
      { closeOnEose: true, groupable: false, cacheUsage },
      relaySet(relays)
    )
    sub.on('event', (event) => {
      const raw = toRaw(event)
      if (raw && raw.id) events.set(raw.id, raw)
    })
    sub.on('eose', finish)
    const timer = setTimeout(finish, timeout)
  })
}

// One-shot fetch → array of plain events.
async function fetchMany(filter, relays, opts) {
  await connect()
  return collect(filter, relays, opts)
}

// One-shot fetch → single (newest) plain event or null.
async function fetchOne(filter, relays, opts) {
  await connect()
  const events = await collect(filter, relays, opts)
  if (!events.length) return null
  return events.reduce((newest, e) => (e.created_at > newest.created_at ? e : newest))
}

// Profile/relay-list reads must reflect the newest event, not a stale cached
// one. PARALLEL queries cache AND relays together so a newer kind-0 / kind-10002
// on a relay wins over an old copy sitting in the Dexie cache.
const FRESH = { cacheUsage: NDKSubscriptionCacheUsage.PARALLEL }

// Generic live subscription that matches the old stream() contract. filterFn
// maps a settings object to { filter, relays }.
function makeStream(filterFn) {
  return function (settings = {}, cb = () => {}, eoseCb = () => {}) {
    let sub = null

    const start = (s) => {
      const { filter, relays } = filterFn(s)
      const subscription = ndk.subscribe(
        filter,
        { closeOnEose: false, groupable: false },
        relaySet(relays)
      )
      subscription.on('event', (event) => {
        try {
          cb([toRaw(event)])
        } catch (err) {
          console.error('[query] stream cb error', err)
        }
      })
      subscription.on('eose', () => eoseCb())
      return subscription
    }

    connect().then(() => {
      sub = start(settings)
    })

    return {
      update(newSettings) {
        if (sub) sub.stop()
        sub = start(newSettings || settings)
      },
      cancel() {
        if (sub) sub.stop()
        sub = null
      }
    }
  }
}

// ── relay status / publish ───────────────────────────────────────────────

export async function getRelayStatus() {
  await connect()
  const status = {}
  ndk.pool.relays.forEach((relay, url) => {
    status[url] = { status: relay.status, connected: relay.connectivity?.connected ?? false }
  })
  return status
}

export async function publish(event, relays) {
  await connect()
  const ndkEvent = new NDKEvent(ndk, event)
  try {
    const published = await ndkEvent.publish(relaySet(relays))
    // NDK returns a Set of relays the event reached.
    return published ? published.size || true : false
  } catch (err) {
    console.error('[query] publish failed', err)
    return false
  }
}

// ── one-shot fetches (call-style) ──────────────────────────────────────────

export async function getFeed(settings = {}) {
  const { authors, limit = 10, relays, since = 0, until = now() } = settings
  const filter = { kinds: [1, 2], limit, until }
  if (since) filter.since = since
  if (authors?.length) filter.authors = authors
  return fetchMany(filter, relays)
}

export async function getProfiles(settings = {}) {
  const { authors, relays } = settings
  const filter = { kinds: [0] }
  if (authors?.length) filter.authors = authors
  return fetchMany(filter, relays, FRESH)
}

export async function getEvents(settings = {}) {
  const { ids, relays } = settings
  if (!ids?.length) return []
  return fetchMany({ ids }, relays)
}

export async function getNotes(settings = {}) {
  const { authors, limit = 10, until = now(), relays } = settings
  return fetchMany({ kinds: [1], authors, limit, until }, relays)
}

// ── live subscriptions (stream-style) ──────────────────────────────────────

export const streamMainProfilesFollows = makeStream(({ authors, relays, user }) => ({
  // Profiles (kind 0) for everyone we follow, but contact lists (kind 3) only
  // for the current user. Requesting kind 3 for every follow streamed each
  // follow's entire (potentially huge, thousands of tags) contact list into
  // memory continuously — events the handler discards anyway — which exhausted
  // memory and crashed mobile clients for accounts with many follows.
  filter: [
    { kinds: [0], authors },
    ...(user ? [{ kinds: [3], authors: [user] }] : []),
  ],
  relays
}))

export const streamMainMentions = makeStream(({ authors, relays, limit = 200 }) => ({
  filter: { kinds: [1], '#p': authors, limit },
  relays
}))

export const streamMainIncomingMessages = makeStream(({ authors, relays, limit = 200 }) => ({
  filter: { kinds: [4], '#p': authors, limit },
  relays
}))

export const streamMainOutgoingMessages = makeStream(({ authors, relays, limit = 200 }) => ({
  filter: { kinds: [4], authors, limit },
  relays
}))

export const streamPeerIncomingMessages = makeStream(({ authors, peers, relays, limit = 500 }) => ({
  filter: { kinds: [4], '#p': authors, authors: peers, limit },
  relays
}))

export const streamPeerOutgoingMessages = makeStream(({ authors, peers, relays, limit = 500 }) => ({
  filter: { kinds: [4], authors, '#p': peers, limit },
  relays
}))

export const streamProfile = makeStream(({ authors, relays }) => ({
  filter: { kinds: [0], authors },
  relays
}))

export const dbStreamEvent = makeStream(({ ids, relays }) => ({
  filter: { ids },
  relays
}))

export const dbStreamFollows = makeStream(({ author, relays }) => ({
  filter: { kinds: [3], authors: [author] },
  relays
}))

// Followers are kind-3 contact lists tagging the user. Those events are large
// (each carries the follower's entire follow list — often thousands of tags), so
// an unbounded query floods memory and crashes mobile. Cap it; the count is
// necessarily approximate on nostr anyway.
export const dbStreamFollowers = makeStream(({ author, relays, limit = 300 }) => ({
  filter: { kinds: [3], '#p': [author], limit },
  relays
}))

export const dbStreamTagKind = makeStream(({ type, values, kinds, limit = 500, relays }) => ({
  filter: { ['#' + type]: values, kinds, limit },
  relays
}))

// ── cache-style reads (db*) ────────────────────────────────────────────────
// These read cache-first and fall back to relays, returning the same shapes
// the sql.js-backed worker did.

export async function dbSave(/* event */) {
  // NDK's cache adapter persists events seen on subscriptions automatically;
  // explicit saves are a no-op kept for call-site compatibility.
  return true
}

export async function dbQuery(/* sql */) {
  // The raw-SQL cache (sql.js) was removed in the overhaul. Callers that ran
  // ad-hoc SQL (DevTools, the kind-3 created_at guard) get an empty result.
  console.warn('[query] dbQuery: raw SQL backend removed in overhaul')
  return []
}

export async function dbEvent(id) {
  return fetchOne({ ids: [id] })
}

export async function dbProfile(pubkey) {
  return fetchOne({ kinds: [0], authors: [pubkey] }, undefined, FRESH)
}

export async function dbFollows(pubkey) {
  return fetchMany({ kinds: [3], authors: [pubkey], limit: 1 })
}

// NIP-65 relay list (kind 10002) — newest wins.
export async function dbRelayList(pubkey) {
  return fetchOne({ kinds: [10002], authors: [pubkey] }, undefined, FRESH)
}

export async function dbChats(pubkey) {
  // Conversation summaries (the old SQL aggregation): one entry per peer with
  // the latest message timestamp. Inbox renders { peer, lastMessage }.
  const incoming = await fetchMany({ kinds: [4], '#p': [pubkey], limit: 500 })
  const outgoing = await fetchMany({ kinds: [4], authors: [pubkey], limit: 500 })

  const latestByPeer = new Map()
  const consider = (peer, ts) => {
    if (!peer || peer === pubkey) return
    const cur = latestByPeer.get(peer)
    if (cur === undefined || ts > cur) latestByPeer.set(peer, ts)
  }
  // incoming: the sender is the peer
  for (const ev of incoming) consider(ev.pubkey, ev.created_at)
  // outgoing: the recipient (#p tag) is the peer
  for (const ev of outgoing) {
    const pTag = (ev.tags || []).find(([t]) => t === 'p')
    consider(pTag && pTag[1], ev.created_at)
  }

  return [...latestByPeer.entries()]
    .map(([peer, lastMessage]) => ({ peer, lastMessage }))
    .sort((a, b) => b.lastMessage - a.lastMessage)
}

export async function dbMessages(userPubkey, peerPubkey, limit = 50, until = now()) {
  const events = await fetchMany({
    kinds: [4],
    authors: [userPubkey, peerPubkey],
    '#p': [userPubkey, peerPubkey],
    until,
    limit
  })
  return events.sort((a, b) => a.created_at - b.created_at)
}

export async function dbMentions(pubkey, limit = 40, until = now()) {
  const events = await fetchMany({ kinds: [1], '#p': [pubkey], until, limit })
  return events.sort((a, b) => b.created_at - a.created_at)
}

export async function dbUnreadMessagesCount(userPubkey, peerPubkey, since = 0) {
  const events = await fetchMany({
    kinds: [4],
    authors: [peerPubkey],
    '#p': [userPubkey],
    since
  })
  return events.length
}

export async function dbUnreadMentionsCount(pubkey, since = 0) {
  const events = await fetchMany({ kinds: [1], '#p': [pubkey], since })
  return events.length
}
