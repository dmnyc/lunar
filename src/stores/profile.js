import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import { debounce } from 'quasar'
import { npubEncode } from 'nostr-tools/nip19'
import { shorten } from '../utils/helpers'
import { getProfiles } from '../query'
import { metadataFromEvent } from '../utils/event'
import Identicon from 'identicon.js'

const LRU_MAX = 3500

// Raw profile data lives outside Pinia state — zero deep-reactivity cost.
// Access is gated through getters that read `_rev` for change tracking.
const _cache = new Map()
const _lru = []

// Batch fetch queue
const _queue = new Set()
let _flushing = false

const _debouncedFlush = debounce(async (store) => {
  if (_flushing || !_queue.size) return
  _flushing = true
  try {
    const batch = [..._queue].slice(0, 50)
    batch.forEach((pk) => _queue.delete(pk))
    const events = await getProfiles({ authors: batch })
    if (events) {
      for (const event of events) store.add(metadataFromEvent(event))
    }
  } catch (err) {
    console.warn('[profileStore] batch fetch failed', err)
  } finally {
    _flushing = false
    if (_queue.size) _debouncedFlush(store)
  }
}, 400)

export const useProfileStore = defineStore('profile', {
  state: () => ({
    _rev: 0 // epoch: bump on every write so getters recompute
  }),

  getters: {
    // Each getter reads _rev so Vue/Pinia re-evaluates it after any add().

    profile(state) {
      void state._rev
      return (pubkey) => _cache.get(pubkey) || null
    },

    name(state) {
      void state._rev
      return (pubkey) => {
        const p = _cache.get(pubkey)
        if (!p) return null
        return p.display_name || p.displayName || p.name || null
      }
    },

    displayName(state) {
      void state._rev
      return (pubkey) => {
        const p = _cache.get(pubkey) || {}
        if (p.display_name || p.displayName || p.name) {
          return p.display_name || p.displayName || p.name
        }
        if (p.nip05) return p.nip05.startsWith('_@') ? p.nip05.slice(2) : p.nip05
        try {
          return shorten(npubEncode(pubkey))
        } catch {
          return shorten(pubkey)
        }
      }
    },

    avatar(state) {
      void state._rev
      return (pubkey) => {
        const p = _cache.get(pubkey)
        if (p?.picture) return p.picture
        try {
          return 'data:image/png;base64,' + new Identicon(pubkey, 40).toString()
        } catch {
          return ''
        }
      }
    },

    nip05Id(state) {
      void state._rev
      return (pubkey) => _cache.get(pubkey)?.nip05 || null
    },

    about(state) {
      void state._rev
      return (pubkey) => _cache.get(pubkey)?.about || ''
    },

    lud(state) {
      void state._rev
      return (pubkey) => {
        const p = _cache.get(pubkey)
        return p ? (p.lud16 || p.lud06 || null) : null
      }
    },

    hasName(state) {
      void state._rev
      return (pubkey) => {
        const p = _cache.get(pubkey) || {}
        return !!(p.display_name || p.displayName || p.name || p.nip05)
      }
    },

    namedProfiles(state) {
      void state._rev
      const result = []
      for (const [pubkey, p] of _cache.entries()) {
        if (p && (p.display_name || p.displayName || p.name || p.nip05)) {
          result.push({ ...p, pubkey })
        }
      }
      return result
    }
  },

  actions: {
    // Add or update a profile in the cache.
    add(metadata) {
      if (!metadata?.pubkey) return
      const { pubkey } = metadata
      const existing = _cache.get(pubkey)
      if (
        existing &&
        metadata.created_at != null &&
        existing.created_at != null &&
        metadata.created_at <= existing.created_at
      ) return

      // LRU tracking
      const lruIdx = _lru.indexOf(pubkey)
      if (lruIdx >= 0) _lru.splice(lruIdx, 1)
      _cache.set(pubkey, markRaw(metadata))
      _lru.push(pubkey)

      if (_lru.length > LRU_MAX) {
        const oldest = _lru.shift()
        _cache.delete(oldest)
      }

      this._rev++
    },

    // Ensure a single profile is in cache; queue a fetch if missing.
    ensure(pubkey) {
      if (!pubkey || _cache.has(pubkey)) return
      _queue.add(pubkey)
      _debouncedFlush(this)
    },

    // Ensure multiple profiles are in cache; batch-fetches missing ones.
    ensureMany(pubkeys) {
      let needed = false
      for (const pk of pubkeys) {
        if (pk && !_cache.has(pk)) {
          _queue.add(pk)
          needed = true
        }
      }
      if (needed) _debouncedFlush(this)
    },

    // Force-fetch a profile from relays (bypasses cache check).
    async fetch(pubkey) {
      const { dbProfile } = await import('../query')
      const event = await dbProfile(pubkey)
      if (event) this.add(metadataFromEvent(event))
      return _cache.get(pubkey) || null
    },

    // Clear the cache (on logout).
    clear() {
      _cache.clear()
      _lru.length = 0
      _queue.clear()
      this._rev++
    }
  }
})
