// Signer abstraction for astral — NIP-07, NIP-46 (bunker:// + nostrconnect://),
// and local private key, behind one interface, on top of NDK.
//
// Ported from zapcooking src/lib/authManager.ts (TS → JS), with astral storage
// keys and app identity. The NIP-46 handling (user-pubkey resolution via real
// get_public_key RPC, NIP-44-aware local signer, signer/user pubkey binding,
// reconnect, and universal nostrconnect:// pairing) is preserved verbatim in
// spirit — that robustness is the whole point of using this instead of NDK's
// signer directly.

import {
  NDKNip07Signer,
  NDKPrivateKeySigner,
  NDKNip46Signer,
  NDKSubscriptionCacheUsage
} from '@nostr-dev-kit/ndk'
import { nip19, getPublicKey, generateSecretKey } from 'nostr-tools'
import * as nip44 from 'nostr-tools/nip44'
import * as nip04 from 'nostr-tools/nip04'
import { fetchNip46UserPubkey } from './nip46Rpc'
import { Nip44LocalSigner } from './nip44LocalSigner'

const browser = typeof window !== 'undefined'
const APP_NAME = 'astral'
const APP_URL = 'https://astral.ninja'

// localStorage keys
const LS_PUBKEY = 'astral_loggedInPublicKey'
const LS_PRIVKEY = 'astral_privateKey'
const LS_METHOD = 'astral_authMethod'
const LS_NIP46 = 'astral_nip46'
const LS_NIP46_PENDING = 'astral_nip46_pending'

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export class AuthManager {
  constructor(ndk) {
    this.ndk = ndk
    this.authState = {
      isAuthenticated: false,
      user: null,
      publicKey: '',
      authMethod: null,
      isLoading: false,
      error: null
    }
    this.listeners = []
    this.nip46Signer = null
    this.nip46ResponseSub = null
    this.initializeFromStorage()
  }

  subscribe(listener) {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  getState() {
    return { ...this.authState }
  }

  updateState(updates) {
    this.authState = { ...this.authState, ...updates }
    this.listeners.forEach((listener) => listener(this.authState))
  }

  async fetchNip46UserPubkey() {
    if (!this.nip46Signer) throw new Error('NIP-46 signer not initialized')
    return fetchNip46UserPubkey(this.nip46Signer)
  }

  async initializeFromStorage() {
    if (!browser) return
    try {
      const storedPublicKey = localStorage.getItem(LS_PUBKEY)
      const storedPrivateKey = localStorage.getItem(LS_PRIVKEY)
      const storedAuthMethod = localStorage.getItem(LS_METHOD)
      const storedNip46 = localStorage.getItem(LS_NIP46)

      if (storedAuthMethod === 'nip46' && storedNip46 && storedPublicKey) {
        try {
          await this.reconnectNIP46(JSON.parse(storedNip46))
          return
        } catch (error) {
          console.error('Failed to restore NIP-46 authentication:', error)
          this.clearStorage()
        }
      }

      if (storedPrivateKey && storedPublicKey) {
        try {
          await this.authenticateWithPrivateKey(storedPrivateKey)
        } catch (error) {
          console.error('Failed to restore authentication:', error)
          this.clearStorage()
        }
      } else if (storedPublicKey && storedAuthMethod === 'nip07') {
        try {
          await this.authenticateWithNIP07()
        } catch (error) {
          console.error('Failed to restore NIP-07 authentication:', error)
          this.clearStorage()
        }
      }
    } catch (error) {
      console.error('Error during authentication initialization:', error)
      this.clearStorage()
    }
  }

  async authenticateWithNIP07() {
    this.updateState({ isLoading: true, error: null })
    try {
      if (!browser) throw new Error('Browser environment required')
      if (!window.nostr) {
        throw new Error(
          'Nostr extension not detected. Please install a compatible extension like Alby or nos2x.'
        )
      }
      const signer = new NDKNip07Signer()
      this.ndk.signer = signer
      const user = await signer.user()
      const publicKey = user.pubkey
      this.ndk.activeUser = user

      this.updateState({
        isAuthenticated: true,
        user,
        publicKey,
        authMethod: 'nip07',
        isLoading: false,
        error: null
      })
      localStorage.setItem(LS_PUBKEY, publicKey)
      localStorage.setItem(LS_METHOD, 'nip07')
      return publicKey
    } catch (error) {
      this.failAuth(error, 'Authentication failed')
      throw error
    }
  }

  async authenticateWithPrivateKey(privateKey) {
    this.updateState({ isLoading: true, error: null })
    try {
      if (!browser) throw new Error('Browser environment required')
      let pk = privateKey.trim()

      if (pk.startsWith('nsec1')) {
        const decoded = nip19.decode(pk)
        if (decoded.type !== 'nsec') throw new Error('Invalid nsec key format')
        pk = bytesToHex(decoded.data)
      }
      if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
        throw new Error('Invalid private key format - expected 64 hex characters or nsec1 key')
      }

      const signer = new NDKPrivateKeySigner(pk)
      this.ndk.signer = signer
      const user = await signer.user()
      const publicKey = user.pubkey
      this.ndk.activeUser = user

      this.updateState({
        isAuthenticated: true,
        user,
        publicKey,
        authMethod: 'privateKey',
        isLoading: false,
        error: null
      })
      localStorage.setItem(LS_PUBKEY, publicKey)
      localStorage.setItem(LS_PRIVKEY, pk)
      localStorage.setItem(LS_METHOD, 'privateKey')
      return { publicKey, privateKey: pk }
    } catch (error) {
      this.failAuth(error, 'Invalid private key')
      throw error
    }
  }

  // bunker:// only (nostrconnect:// is client-generated, not user input)
  parseNIP46ConnectionString(connectionString) {
    const trimmed = connectionString.trim()
    if (trimmed.startsWith('nostrconnect://')) {
      throw new Error(
        'nostrconnect:// URIs are for signers to scan. Please use a bunker:// connection string from your signer app.'
      )
    }
    if (trimmed.startsWith('bunker://')) {
      const url = new URL(trimmed)
      let signerPubkey = url.hostname || url.pathname.replace('//', '')
      if (signerPubkey.startsWith('npub1')) {
        const decoded = nip19.decode(signerPubkey)
        if (decoded.type !== 'npub') throw new Error('Invalid npub in connection string')
        signerPubkey = decoded.data
      }
      if (!/^[0-9a-fA-F]{64}$/.test(signerPubkey)) throw new Error('Invalid signer pubkey format')
      const relays = url.searchParams.getAll('relay')
      if (relays.length === 0) throw new Error('No relay specified in connection string')
      const secret = url.searchParams.get('secret') || undefined
      return { signerPubkey, relays, secret }
    }
    if (trimmed.startsWith('npub1')) {
      const parts = trimmed.split(/\s+/)
      const decoded = nip19.decode(parts[0])
      if (decoded.type !== 'npub') throw new Error('Invalid npub format')
      const relays = parts.slice(1).filter((r) => r.startsWith('wss://'))
      if (relays.length === 0) {
        throw new Error('No relay specified. Please add relay URLs after the npub.')
      }
      return { signerPubkey: decoded.data, relays }
    }
    throw new Error('Invalid connection string. Use bunker:// or npub with relay hints.')
  }

  async authenticateWithNIP46(connectionString) {
    this.updateState({ isLoading: true, error: null })
    try {
      if (!browser) throw new Error('Browser environment required')
      const { signerPubkey, relays, secret } = this.parseNIP46ConnectionString(connectionString)

      const localPrivateKey = bytesToHex(generateSecretKey())
      const localSigner = new Nip44LocalSigner(localPrivateKey)

      for (const relay of relays) {
        try {
          this.ndk.addExplicitRelay(relay)
        } catch (e) {
          console.warn('[NIP-46] Failed to add relay:', relay, e)
        }
      }
      await this.ndk.connect()

      const signerToken = secret ? `${signerPubkey}#${secret}` : signerPubkey
      this.nip46Signer = new NDKNip46Signer(this.ndk, signerToken, localSigner)
      this.primeSignerPubkeys(signerPubkey)
      this.ndk.signer = this.nip46Signer

      try {
        await Promise.race([this.nip46Signer.blockUntilReady(), this.timeout(30000, 'Connection timeout - bunker not responding')])
      } catch (e) {
        console.warn('[NIP-46] connect phase timed out, will still try get_public_key:', e)
      }

      const userPubkey = await this.fetchNip46UserPubkey()
      const user = this.ndk.getUser({ pubkey: userPubkey })
      this.bindUserToSigner(user)

      this.updateState({
        isAuthenticated: true,
        user,
        publicKey: userPubkey,
        authMethod: 'nip46',
        isLoading: false,
        error: null
      })

      const redacted = secret ? connectionString.replace(secret, '***REDACTED***') : connectionString
      const nip46Info = { signerPubkey, userPubkey, relays, connectionString: redacted, localPrivateKey, secret }
      localStorage.setItem(LS_PUBKEY, userPubkey)
      localStorage.setItem(LS_METHOD, 'nip46')
      localStorage.setItem(LS_NIP46, JSON.stringify(nip46Info))
      return userPubkey
    } catch (error) {
      this.nip46Signer = null
      this.failAuth(error, 'Failed to connect to bunker')
      throw error
    }
  }

  async reconnectNIP46(nip46Info) {
    this.updateState({ isLoading: true, error: null })
    try {
      const localPrivateKey = nip46Info.localPrivateKey || bytesToHex(generateSecretKey())
      const localSigner = new Nip44LocalSigner(localPrivateKey)

      for (const relay of nip46Info.relays) {
        try {
          this.ndk.addExplicitRelay(relay)
        } catch (e) {
          console.warn('[NIP-46] Failed to add relay:', relay, e)
        }
      }
      await this.ndk.connect()

      const signerToken = nip46Info.secret
        ? `${nip46Info.signerPubkey}#${nip46Info.secret}`
        : nip46Info.signerPubkey
      this.nip46Signer = new NDKNip46Signer(this.ndk, signerToken, localSigner)
      this.primeSignerPubkeys(nip46Info.signerPubkey)
      this.ndk.signer = this.nip46Signer

      try {
        await Promise.race([this.nip46Signer.blockUntilReady(), this.timeout(15000, 'Bunker reconnection timeout')])
      } catch (e) {
        console.warn('[NIP-46] Reconnection session establishment failed/timed out:', e)
      }

      let userPubkey = nip46Info.userPubkey
      try {
        const actual = await this.fetchNip46UserPubkey()
        userPubkey = actual
        if (nip46Info.userPubkey !== actual) {
          nip46Info.userPubkey = actual
          localStorage.setItem(LS_NIP46, JSON.stringify(nip46Info))
          localStorage.setItem(LS_PUBKEY, actual)
        }
      } catch (e) {
        console.warn('[NIP-46] Could not get user pubkey, using stored value:', e)
      }

      const user = this.ndk.getUser({ pubkey: userPubkey })
      this.bindUserToSigner(user)
      this.updateState({
        isAuthenticated: true,
        user,
        publicKey: userPubkey,
        authMethod: 'nip46',
        isLoading: false,
        error: null
      })
      return userPubkey
    } catch (error) {
      this.nip46Signer = null
      this.updateState({
        isAuthenticated: false,
        user: null,
        publicKey: '',
        authMethod: null,
        isLoading: false,
        error: 'Bunker not reachable. Please check your connection or reconnect.'
      })
      throw error
    }
  }

  // ── universal nostrconnect:// pairing (Amber / mobile QR flow) ────────────

  generateSecret() {
    const array = new Uint8Array(16)
    crypto.getRandomValues(array)
    return bytesToHex(array)
  }

  async startNip46PairingUniversal() {
    if (!browser) throw new Error('Browser environment required')
    const localPrivateKeyBytes = generateSecretKey()
    const localPrivateKey = bytesToHex(localPrivateKeyBytes)
    const localPubkey = getPublicKey(localPrivateKeyBytes)
    const secret = this.generateSecret()

    let relays = []
    if (this.ndk.pool && this.ndk.pool.relays && this.ndk.pool.relays.size > 0) {
      relays = Array.from(this.ndk.pool.relays.keys())
    }
    if (relays.length === 0) relays = ['wss://relay.damus.io', 'wss://nos.lol']

    localStorage.setItem(
      LS_NIP46_PENDING,
      JSON.stringify({ localPrivateKey, localPubkey, relays, secret, startedAt: Date.now() })
    )

    const params = new URLSearchParams()
    relays.forEach((r) => params.append('relay', r))
    params.set('secret', secret)
    params.set('name', APP_NAME)
    params.set('url', APP_URL)
    const uri = `nostrconnect://${localPubkey}?${params.toString()}`

    for (const relay of relays) {
      try {
        this.ndk.addExplicitRelay(relay)
      } catch (e) {
        console.warn('[NIP-46] Failed to add relay:', relay, e)
      }
    }
    await this.ndk.connect()
    this.startNip46ResponseListener(localPubkey)
    return { uri, relays }
  }

  async decryptNip44(ciphertext, senderPubkey, recipientPrivateKey) {
    const privateKeyBytes = new Uint8Array(
      recipientPrivateKey.match(/.{1,2}/g).map((b) => parseInt(b, 16))
    )
    try {
      const conversationKey = nip44.v2.utils.getConversationKey(privateKeyBytes, senderPubkey)
      return nip44.v2.decrypt(ciphertext, conversationKey)
    } catch (nip44Error) {
      try {
        return await nip04.decrypt(recipientPrivateKey, senderPubkey, ciphertext)
      } catch {
        throw new Error('Failed to decrypt response')
      }
    }
  }

  startNip46ResponseListener(localPubkey) {
    if (this.nip46ResponseSub) {
      this.nip46ResponseSub.stop()
      this.nip46ResponseSub = null
    }
    const filter = {
      kinds: [24133],
      '#p': [localPubkey],
      since: Math.floor((Date.now() - 5 * 60 * 1000) / 1000)
    }
    const sub = this.ndk.subscribe(filter, {
      closeOnEose: false,
      groupable: false,
      cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY
    })
    this.nip46ResponseSub = sub
    let isProcessing = false

    sub.on('event', async (event) => {
      if (isProcessing) return
      const signerPubkey = event.pubkey
      const pendingInfo = this.getPendingNip46Info()
      if (!pendingInfo) return

      let response
      try {
        const decrypted = await this.decryptNip44(event.content, signerPubkey, pendingInfo.localPrivateKey)
        response = JSON.parse(decrypted)
      } catch (e) {
        return
      }
      if (response.error) return
      if (response.method && response.method !== 'connect') return

      const result = response.result
      const isAckOnly = result === 'ack'
      const isSecretMatch = typeof result === 'string' && result === pendingInfo.secret
      if (!isAckOnly && !isSecretMatch) return

      try {
        isProcessing = true
        await this.completeNip46PairingWithSignerPubkey(signerPubkey)
        sub.stop()
        if (this.nip46ResponseSub === sub) this.nip46ResponseSub = null
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('No pending NIP-46 pairing found')) {
          sub.stop()
          if (this.nip46ResponseSub === sub) this.nip46ResponseSub = null
        } else {
          console.error('[NIP-46] Failed to complete pairing:', e)
        }
      } finally {
        isProcessing = false
      }
    })
    sub.on('close', () => {
      if (this.nip46ResponseSub === sub) this.nip46ResponseSub = null
    })
  }

  hasPendingNip46Pairing() {
    if (!browser) return false
    const pending = localStorage.getItem(LS_NIP46_PENDING)
    if (!pending) return false
    try {
      const info = JSON.parse(pending)
      if (Date.now() - info.startedAt > 5 * 60 * 1000) {
        localStorage.removeItem(LS_NIP46_PENDING)
        return false
      }
      return true
    } catch {
      return false
    }
  }

  getPendingNip46Info() {
    if (!browser) return null
    const pending = localStorage.getItem(LS_NIP46_PENDING)
    if (!pending) return null
    try {
      return JSON.parse(pending)
    } catch {
      return null
    }
  }

  async completeNip46PairingWithSignerPubkey(signerPubkey) {
    const currentAuth = this.getState()
    if (currentAuth.isAuthenticated && currentAuth.authMethod === 'nip46') {
      const storedNip46 = localStorage.getItem(LS_NIP46)
      if (storedNip46) {
        try {
          if (JSON.parse(storedNip46).signerPubkey === signerPubkey) return
        } catch (e) {
          /* invalid stored data, continue */
        }
      }
    }
    const pendingInfo = this.getPendingNip46Info()
    if (!pendingInfo) throw new Error('No pending NIP-46 pairing found')

    this.updateState({ isLoading: true, error: null })
    try {
      const localSigner = new Nip44LocalSigner(pendingInfo.localPrivateKey)
      for (const relay of pendingInfo.relays) {
        try {
          this.ndk.addExplicitRelay(relay)
        } catch (e) {
          console.warn('[NIP-46] Failed to add relay:', relay, e)
        }
      }
      await this.ndk.connect()

      const signerToken = pendingInfo.secret ? `${signerPubkey}#${pendingInfo.secret}` : signerPubkey
      this.nip46Signer = new NDKNip46Signer(this.ndk, signerToken, localSigner)
      this.ndk.signer = this.nip46Signer

      try {
        await Promise.race([this.nip46Signer.blockUntilReady(), this.timeout(15000, 'Session establishment timeout')])
      } catch (e) {
        console.warn('[NIP-46] Session establishment timed out:', e)
      }

      const userPubkey = await this.fetchNip46UserPubkey()
      const user = this.ndk.getUser({ pubkey: userPubkey })
      this.bindUserToSigner(user)

      const nip46Info = {
        signerPubkey,
        userPubkey,
        relays: pendingInfo.relays,
        connectionString: `bunker://${signerPubkey}?${pendingInfo.relays
          .map((r) => `relay=${encodeURIComponent(r)}`)
          .join('&')}`,
        localPrivateKey: pendingInfo.localPrivateKey
      }
      localStorage.setItem(LS_PUBKEY, userPubkey)
      localStorage.setItem(LS_METHOD, 'nip46')
      localStorage.setItem(LS_NIP46, JSON.stringify(nip46Info))
      localStorage.removeItem(LS_NIP46_PENDING)

      this.updateState({
        isAuthenticated: true,
        user,
        publicKey: userPubkey,
        authMethod: 'nip46',
        isLoading: false,
        error: null
      })
      return userPubkey
    } catch (error) {
      this.nip46Signer = null
      this.ndk.signer = undefined
      this.failAuth(error, 'Failed to complete pairing')
      throw error
    }
  }

  // NDKNip46Signer.user() returns the SIGNER pubkey, not the user pubkey, and
  // never updates it. For bunkers whose signer pubkey differs from the user
  // pubkey, point the signer's reported user at the real user so signed events
  // carry the correct pubkey.
  bindUserToSigner(user) {
    if (this.nip46Signer) this.nip46Signer.remoteUser = user
    this.ndk.activeUser = user
  }

  primeSignerPubkeys(signerPubkey) {
    try {
      this.nip46Signer.bunkerPubkey = signerPubkey
      this.nip46Signer._bunkerPubkey = signerPubkey
      this.nip46Signer.userPubkey = signerPubkey
      this.nip46Signer._userPubkey = signerPubkey
      this.nip46Signer._remoteUser = this.ndk.getUser({ pubkey: signerPubkey })
    } catch (e) {
      console.warn('[NIP-46] Could not set signer properties:', e)
    }
  }

  timeout(ms, message) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  }

  failAuth(error, fallback) {
    console.error('Authentication failed:', error)
    this.updateState({
      isAuthenticated: false,
      user: null,
      publicKey: '',
      authMethod: null,
      isLoading: false,
      error: error instanceof Error ? error.message : fallback
    })
  }

  async logout() {
    if (this.nip46Signer) this.nip46Signer = null
    if (this.nip46ResponseSub) {
      this.nip46ResponseSub.stop()
      this.nip46ResponseSub = null
    }
    this.updateState({
      isAuthenticated: false,
      user: null,
      publicKey: '',
      authMethod: null,
      isLoading: false,
      error: null
    })
    this.clearStorage()
    this.ndk.signer = undefined
    this.ndk.activeUser = undefined
  }

  clearStorage() {
    if (!browser) return
    if (this.nip46ResponseSub) {
      this.nip46ResponseSub.stop()
      this.nip46ResponseSub = null
    }
    localStorage.removeItem(LS_PUBKEY)
    localStorage.removeItem(LS_PRIVKEY)
    localStorage.removeItem(LS_METHOD)
    localStorage.removeItem(LS_NIP46)
    localStorage.removeItem(LS_NIP46_PENDING)
  }

  isNIP07Available() {
    return browser && !!window.nostr
  }
}

// Singleton bound to the app's NDK instance.
let authManager = null
export function createAuthManager(ndk) {
  if (!authManager) authManager = new AuthManager(ndk)
  else authManager.ndk = ndk
  return authManager
}
export function getAuthManager() {
  return authManager
}
