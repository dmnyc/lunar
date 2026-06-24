// Feed engine — a memory-bounded timeline over NDK.
//
// The 2022 feed kept every event in deep-reactive Vuex state, deep-cloned each
// event (JSON.parse(JSON.stringify)), and built nested reactive thread arrays.
// Building all those Vue proxies on first paint exhausted memory and crashed
// mobile Safari ("a problem repeatedly occurred").
//
// This engine borrows the model proven by Jumble (github.com/CodyTseng/jumble):
//   - Raw events live in a PLAIN Map, entirely outside Vue reactivity. They are
//     never wrapped in proxies, so thousands of them cost a few MB, not the tens
//     of MB reactive proxies would.
//   - The reactive surface is a shallowRef of event IDs (tiny). Only the array
//     identity is tracked; mutating it doesn't deep-convert anything.
//   - The view layer renders ids → events via getEvent() inside a virtualized
//     list, so only the on-screen slice is ever mounted in the DOM.
//   - Live events arriving while you read are buffered (not auto-prepended) and
//     surfaced via a "show new" button, avoiding scroll-jump re-renders.
//
// Net effect: continuous endless scroll with a flat memory profile. No hard cap
// is needed for memory — refs are tiny, events are plain, the DOM is bounded.

import { ref, shallowRef } from 'vue'
import { NDKRelaySet, NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk'
import ndk, { connect } from './ndk'

const nowSec = () => Math.round(Date.now() / 1000)
const toRaw = (e) => (e && e.rawEvent ? e.rawEvent() : e)

// Insert id into a newest-first id array at its sorted position.
function insertDesc(ids, id, at) {
  let lo = 0
  let hi = ids.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (at(ids[mid]) > at(id)) lo = mid + 1
    else hi = mid
  }
  ids.splice(lo, 0, id)
  return ids
}

/**
 * Create a feed bound to a filter.
 *
 * @param {object} opts
 * @param {number[]} opts.kinds       event kinds to subscribe (default [1])
 * @param {string[]|null} opts.authors author pubkeys, or null for global
 * @param {object|null} opts.baseFilter if set, used as the NIP-01 filter base
 *   instead of building one from kinds+authors. Useful for tag filters (#p, #t).
 * @param {string[]|null} opts.relays  explicit relay urls, or null for ndk default
 * @param {number} opts.pageSize       events per page (default 50)
 * @param {number} opts.pendingCap     max buffered live notes (default 500)
 * @param {(e:object)=>void} [opts.enrich]   mutate each event before storing (e.g. interpolate mentions)
 * @param {(e:object)=>boolean} [opts.valid] reject events that return false
 */
export function createFeed({
  kinds = [1],
  authors = null,
  baseFilter = null,
  relays = null,
  pageSize = 50,
  pendingCap = 500,
  enrich = null,
  valid = null
} = {}) {
  // ── non-reactive store (the whole point) ──────────────────────────────────
  const events = new Map() // id -> plain enriched event
  const seen = new Set() // every id ever accepted (dedup)

  // ── reactive surface (ids only; shallow) ──────────────────────────────────
  const timeline = shallowRef([]) // visible ids, newest first
  const pending = shallowRef([]) // buffered live ids, newest first
  const loading = ref(false)
  const reachedEnd = ref(false)

  let liveSub = null
  let oldestUntil = nowSec() // pagination cursor for older pages
  let newestAt = 0 // created_at of the newest event we've shown
  let started = false

  const at = (id) => events.get(id)?.created_at || 0

  function rs() {
    if (relays && relays.length) {
      try {
        return NDKRelaySet.fromRelayUrls(relays, ndk)
      } catch (_) {
        return undefined
      }
    }
    return undefined
  }

  function buildFilter(extra) {
    if (baseFilter) return { ...baseFilter, ...extra }
    const filter = { kinds, ...extra }
    if (authors && authors.length) filter.authors = authors
    return filter
  }

  // Normalize, validate, enrich and store an incoming NDK event. Returns the
  // plain event on first sight, or null if duplicate/invalid.
  function accept(ndkEvent) {
    const e = toRaw(ndkEvent)
    if (!e || !e.id || seen.has(e.id)) return null
    if (valid && !valid(e)) return null
    seen.add(e.id)
    if (typeof e.replies === 'undefined') e.replies = []
    if (enrich) {
      try {
        enrich(e)
      } catch (_) {
        /* enrichment is best-effort */
      }
    }
    events.set(e.id, e)
    return e
  }

  // One-shot older-page fetch, until-paginated. Drives the subscription itself
  // and always settles (mirrors query.js collect()), since some relays never
  // send EOSE for author filters.
  function fetchPage(until) {
    return new Promise((resolve) => {
      const collected = []
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
        resolve(collected)
      }
      const sub = ndk.subscribe(
        buildFilter({ limit: pageSize, until }),
        // PARALLEL queries cache AND relays together: cached events paint instantly
        // while relays fill in fresh ones. (CACHE_FIRST can EOSE on an empty cache
        // before relays answer, yielding an empty page.)
        { closeOnEose: true, groupable: false, cacheUsage: NDKSubscriptionCacheUsage.PARALLEL },
        rs()
      )
      sub.on('event', (ev) => {
        const e = accept(ev)
        if (e) collected.push(e)
      })
      sub.on('eose', finish)
      const timer = setTimeout(finish, 6000)
    })
  }

  // Live tail subscription: everything newer than what we've shown goes to the
  // pending buffer. Kept open until stop()/destroy().
  function startLive() {
    if (liveSub) return
    liveSub = ndk.subscribe(
      buildFilter({ since: newestAt + 1 }),
      { closeOnEose: false, groupable: false },
      rs()
    )
    liveSub.on('event', (ev) => {
      const e = accept(ev)
      if (!e || e.created_at <= newestAt) return
      const next = insertDesc(pending.value.slice(), e.id, at)
      pending.value = next.length > pendingCap ? next.slice(0, pendingCap) : next
    })
  }

  async function start() {
    if (started) return
    started = true
    await connect()
    loading.value = true
    const page = await fetchPage(oldestUntil)
    const ids = page.map((e) => e.id).sort((a, b) => at(b) - at(a))
    timeline.value = ids
    if (ids.length) {
      newestAt = at(ids[0])
      oldestUntil = at(ids[ids.length - 1]) - 1
    }
    if (page.length < pageSize) reachedEnd.value = true
    loading.value = false
    startLive()
  }

  async function loadMore() {
    if (loading.value || reachedEnd.value || !started) return
    loading.value = true
    const page = await fetchPage(oldestUntil)
    if (page.length) {
      const older = page.map((e) => e.id).sort((a, b) => at(b) - at(a))
      timeline.value = timeline.value.concat(older)
      oldestUntil = at(timeline.value[timeline.value.length - 1]) - 1
    }
    if (page.length < pageSize) reachedEnd.value = true
    loading.value = false
  }

  // Merge the buffered live notes onto the top of the timeline.
  function showNew() {
    if (!pending.value.length) return
    timeline.value = pending.value.concat(timeline.value)
    newestAt = at(timeline.value[0])
    pending.value = []
  }

  function stop() {
    if (liveSub) {
      try {
        liveSub.stop()
      } catch (_) {
        /* already stopped */
      }
      liveSub = null
    }
  }

  // Full reset — drop subscriptions and all stored events/ids.
  function destroy() {
    stop()
    events.clear()
    seen.clear()
    timeline.value = []
    pending.value = []
    started = false
    reachedEnd.value = false
    oldestUntil = nowSec()
    newestAt = 0
  }

  return {
    // reactive
    timeline,
    pending,
    loading,
    reachedEnd,
    // lookups & control
    getEvent: (id) => events.get(id),
    start,
    loadMore,
    showNew,
    stop,
    resume: startLive, // re-open the live tail after stop() (visibility gating)
    destroy
  }
}
