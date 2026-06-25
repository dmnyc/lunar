import { defineStore } from 'pinia'
import { LocalStorage } from 'quasar'
import ndk from '../nostr/ndk'
import { signAsynchronously, metadataFromEvent } from '../utils/event'
import { publish, dbFollows, streamMainProfilesFollows } from '../query'
import { getPublicKey, nip06, privateKeyFromSeedWords } from '../utils/ntcompat'
import { useProfileStore } from './profile'
import { useRelayStore } from './relay'

const BOT_TRACKER = '29f63b70d8961835b14062b195fc7d84fa810560b36dde0749e4bc084f0f8952'

// Main subscription handle — lives outside Pinia state (not persisted/reactive)
let _mainSub = null
let _latestKind3At = 0

function buildConfig(saved) {
  const { timestamps = {}, preferences = {} } = saved || {}
  const { color = {}, font = 'Roboto', lightningTips = {} } = preferences
  return {
    timestamps: {
      lastUserMainSync: timestamps.lastUserMainSync || 0,
      lastFeedLoad: timestamps.lastFeedLoad || 0
    },
    preferences: {
      color: {
        primary: color.primary || '#d671ea',
        secondary: color.secondary || '#5af2e0',
        accent: color.accent || '#ecc865',
        background: color.background || '#1f1f1f'
      },
      font,
      lightningTips: {
        enabled: lightningTips.enabled !== false,
        lastMode: lightningTips.lastMode || 'copy',
        lastWallet: lightningTips.lastWallet || null,
        presets: lightningTips.presets || [10, 100, 1000],
        oneClick: lightningTips.oneClick || { enabled: false, amount: 10 }
      }
    }
  }
}

export const useUserStore = defineStore('user', {
  state: () => {
    const saved = LocalStorage.getItem('keys') || {}
    return {
      pub: saved.pub || null,
      priv: saved.priv || null,
      follows: LocalStorage.getItem('follows') || [],
      config: buildConfig(LocalStorage.getItem('config'))
    }
  },

  getters: {
    canSign: () => !!(
      ndk.signer ||
      (typeof window !== 'undefined' && window.nostr)
    ),
    canEncrypt: () => !!(
      ndk.signer ||
      (typeof window !== 'undefined' && window.nostr?.nip04)
    )
  },

  actions: {
    // ── keys ──────────────────────────────────────────────────────────────

    setKeys({ priv, pub, mnemonic } = {}) {
      if (!mnemonic && !priv && !pub) mnemonic = nip06.generateSeedWords()
      if (mnemonic) priv = privateKeyFromSeedWords(mnemonic)
      if (priv) pub = getPublicKey(priv)
      this.priv = priv || null
      this.pub = pub || null
      LocalStorage.set('keys', { priv: this.priv, pub: this.pub })
    },

    // ── follows ───────────────────────────────────────────────────────────

    setFollows(follows) {
      this.follows = follows
      LocalStorage.set('follows', follows)
    },

    follow(pubkey) {
      if (!pubkey || this.pub === pubkey || this.follows.includes(pubkey)) return
      this.follows.push(pubkey)
      LocalStorage.set('follows', this.follows)
    },

    unfollow(pubkey) {
      const idx = this.follows.indexOf(pubkey)
      if (idx >= 0) this.follows.splice(idx, 1)
      LocalStorage.set('follows', this.follows)
    },

    reorderFollows(follows) {
      this.follows = follows
      LocalStorage.set('follows', follows)
    },

    // ── config ────────────────────────────────────────────────────────────

    setConfig(key, value) {
      this.config[key] = value
      LocalStorage.set('config', this.config)
    },

    setConfigLightningTips(key, value) {
      this.config.preferences.lightningTips[key] = value
      LocalStorage.set('config', this.config)
    },

    // ── launch / main subscription ────────────────────────────────────────

    async launch() {
      if (!this.pub) return
      await useRelayStore().load(this.pub)
      this._restartMainSub()
    },

    _restartMainSub() {
      const relayStore = useRelayStore()
      const profileStore = useProfileStore()
      const relays = relayStore.urls
      const authors = [this.pub, ...this.follows, BOT_TRACKER]

      const onEvent = (events) => {
        for (const event of events) {
          if (event.kind === 0) {
            profileStore.add(metadataFromEvent(event))
          } else if (event.pubkey === this.pub && event.kind === 3) {
            if (event.created_at <= _latestKind3At) continue
            _latestKind3At = event.created_at
            const follows = event.tags
              .filter(([t, v]) => t === 'p' && v)
              .map(([_, v]) => v)
            this.setFollows(follows)
            this._restartMainSub()
          }
        }
      }

      if (_mainSub) {
        _mainSub.update({ authors, relays, user: this.pub })
      } else {
        _mainSub = streamMainProfilesFollows(
          { authors, relays, user: this.pub },
          onEvent
        )
      }
    },

    stopMainSub() {
      if (_mainSub) {
        _mainSub.cancel()
        _mainSub = null
        _latestKind3At = 0
      }
    },

    // ── publishing ────────────────────────────────────────────────────────

    async publishEvent(unpublishedEvent) {
      const relays = useRelayStore().urls

      // NIP-89 client tag — skip for private event kinds
      const privateKinds = new Set([4, 13, 14, 1059])
      if (
        !privateKinds.has(unpublishedEvent.kind) &&
        !(unpublishedEvent.tags || []).some((t) => t[0] === 'client')
      ) {
        unpublishedEvent.tags = [...(unpublishedEvent.tags || []), ['client', 'lunar']]
      }

      // signAsynchronously expects { state: { keys: { priv } } } shape
      const fakeStore = { state: { keys: { priv: this.priv, pub: this.pub } } }
      const event = await signAsynchronously(unpublishedEvent, fakeStore)
      await publish(event, relays)
      return event
    },

    async sendPost({ message, tags = [], kind = 1 }) {
      if (!message.length) return
      return this.publishEvent({
        pubkey: this.pub,
        created_at: Math.floor(Date.now() / 1000),
        kind,
        tags,
        content: message
      })
    },

    async publishContactList() {
      const [oldEvent] = await dbFollows(this.pub)
      const oldTags = oldEvent?.tags || []
      const newTags = this.follows.map((pubkey) => {
        const existing = oldTags.find(([t, v]) => t === 'p' && v === pubkey)
        return existing || ['p', pubkey]
      })
      return this.publishEvent({
        pubkey: this.pub,
        created_at: Math.floor(Date.now() / 1000),
        kind: 3,
        tags: newTags,
        content: JSON.stringify(useRelayStore().relays)
      })
    },

    async publishMetadata(metadata) {
      if (metadata.created_at) delete metadata.created_at
      return this.publishEvent({
        pubkey: this.pub,
        created_at: Math.floor(Date.now() / 1000),
        kind: 0,
        tags: [],
        content: JSON.stringify(metadata)
      })
    }
  }
})
