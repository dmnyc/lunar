import { boot } from 'quasar/wrappers'
import ndk from '../nostr/ndk'
import { createAuthManager } from '../nostr/authManager'

// Instantiate the AuthManager singleton at startup. Its constructor runs
// initializeFromStorage(), which restores the active NDK signer on reload for
// NIP-07 and NIP-46 sessions (legacy local-key sessions sign via the Vuex
// keys.priv path and are untouched here).
export default boot(() => {
  createAuthManager(ndk)
})
