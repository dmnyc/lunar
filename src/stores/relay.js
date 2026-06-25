import { defineStore } from 'pinia'
import { LocalStorage } from 'quasar'
import { DEFAULT_RELAYS, addRelays } from '../nostr/ndk'
import { dbRelayList } from '../query'

export const useRelayStore = defineStore('relay', {
  state: () => ({
    relays: LocalStorage.getItem('relays') || {} // { [url]: { read, write } }
  }),

  getters: {
    // All relay URLs (read or write). Falls back to NDK defaults when none saved.
    urls: (state) => {
      const keys = Object.keys(state.relays)
      return keys.length ? keys : DEFAULT_RELAYS
    },

    writeUrls: (state) => {
      const keys = Object.keys(state.relays).filter(
        (url) => state.relays[url]?.write !== false
      )
      return keys.length ? keys : DEFAULT_RELAYS
    },

    readUrls: (state) => {
      const keys = Object.keys(state.relays).filter(
        (url) => state.relays[url]?.read !== false
      )
      return keys.length ? keys : DEFAULT_RELAYS
    }
  },

  actions: {
    // Fetch the user's NIP-65 (kind 10002) relay list and adopt it.
    async load(pub) {
      if (!pub) return
      try {
        const event = await dbRelayList(pub)
        if (!event?.tags) return
        const relays = {}
        for (const [t, url, marker] of event.tags) {
          if (t !== 'r' || !url) continue
          relays[url] = {
            read: marker !== 'write',
            write: marker !== 'read'
          }
        }
        if (Object.keys(relays).length) {
          this.save(relays)
          addRelays(Object.keys(relays))
        }
      } catch (err) {
        console.warn('[relayStore] load failed', err)
      }
    },

    // Replace the full relay map and persist.
    save(relays) {
      this.relays = relays
      LocalStorage.set('relays', relays)
    },

    // Add a relay with read+write defaults.
    add(url) {
      try { new URL(url) } catch { return }
      if (!/^wss?:\/\//.test(url)) return
      this.relays[url] = { read: true, write: true }
      LocalStorage.set('relays', this.relays)
    },

    remove(url) {
      delete this.relays[url]
      LocalStorage.set('relays', this.relays)
    },

    setOpt(url, opt, value) {
      if (url in this.relays) {
        this.relays[url][opt] = value
        LocalStorage.set('relays', this.relays)
      }
    }
  }
})
