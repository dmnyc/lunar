import { boot } from 'quasar/wrappers'
import { LocalStorage } from 'quasar'
import { initBitcoinConnect } from '../nostr/wallet/bitcoinConnect'

// If the user previously connected a wallet via Bitcoin Connect, initialize it
// on startup so its onConnected fires and the WebLN-compatible provider is
// restored (otherwise the persisted wallet couldn't pay until first use).
// Skipped entirely when no Bitcoin Connect wallet is stored, to avoid loading
// its web components for everyone.
export default boot(() => {
  try {
    const wallets = LocalStorage.getItem('astral_wallets') || []
    if (Array.isArray(wallets) && wallets.some((w) => w && w.data === 'bitcoin-connect')) {
      initBitcoinConnect()
    }
  } catch (_) {
    /* storage unavailable */
  }
})
