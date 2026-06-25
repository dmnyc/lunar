import {LocalStorage} from 'quasar'
import { DEFAULT_RELAYS } from '../nostr/ndk'

const isClientUsingTor = () => window.location.hostname.endsWith('.onion')

const mainnetDefaultRelays = Object.fromEntries(DEFAULT_RELAYS.map(url => [url, { read: true, write: true }]))

const mainnetOptionalRelays = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://offchain.pub',
  'wss://relay.nos.social',
  'wss://nostr.oxtr.dev',
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://relay.nostr.wirednet.jp',
]

const torDefaultRelays = {
  'ws://jgqaglhautb4k6e6i2g34jakxiemqp6z4wynlirltuukgkft2xuglmqd.onion': {
    read: true,
    write: true
  },
  'ws://wagvwfrdrikrqzp7h3b5lwl6btyuttu7mqpeji35ljzq36ovzgjhsfqd.onion': {
    read: true,
    write: true
  }
}

export default function () {
  const defaultRelays = isClientUsingTor() ? torDefaultRelays : mainnetDefaultRelays
  const optionalRelaysList = isClientUsingTor() ? Object.keys(torDefaultRelays) : mainnetOptionalRelays
  let config = LocalStorage.getItem('config')
  let { timestamps, preferences } = config || {}
  let { lastUserMainSync = 0, lastFeedLoad = 0 } = timestamps || {}
  let { color, font = 'Roboto', lightningTips } = preferences || {}
  // Lunar theme is the default (was the white/gray "mono" default in astral).
  let { primary = '#d671ea', secondary = '#5af2e0', accent = '#ecc865', background = '#1f1f1f' } = color || {}
  let { enabled = true, lastMode = 'copy', lastWallet = null, presets = [10, 100, 1000], oneClick = { enabled: false, amount: 10 } } = lightningTips || {}
  config = {
    timestamps: {
      lastUserMainSync,
      lastFeedLoad
    },
    preferences: {
      color: {
        primary,
        secondary,
        accent,
        background
      },
      font,
      lightningTips: {
        enabled,
        lastMode,
        lastWallet,
        presets,
        oneClick,
      }
    }
  }

  return {
    keys: LocalStorage.getItem('keys') || {}, // {priv, pub }

    relays: LocalStorage.getItem('relays') || {}, // { [url]: {} }
    defaultRelays, // { [url]: {} }
    optionalRelaysList, // [ urls... ]
    follows: LocalStorage.getItem('follows') || [], // [ pubkeys... ]

    profilesCache: {}, // { [pubkey]: {name, about, picture, ...} }
    profilesCacheLRU: [], // [ pubkeys... ]
    eventsCache: {}, // { [id]: event }
    eventsCacheLRU: [], // [ ids... ]
    contactListCache: {}, // { [pubkey]: {name, about, picture, ...} }
    contactListCacheLRU: [], // [ pubkeys... ]
    nip05VerificationCache: {}, // { [identifier]: {pubkey, when }

    lastMessageRead: LocalStorage.getItem('lastMessageRead') || {},
    unreadMessages: {},

    lastNotificationRead: LocalStorage.getItem('lastNotificationRead') || 0,
    unreadNotifications: 0,

    config
  }
}
