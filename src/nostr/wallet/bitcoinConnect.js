// Bitcoin Connect (@getalby/bitcoin-connect) — a unified connect/pay modal
// supporting WebLN, NWC, and Alby, with a built-in QR. Loaded lazily so its
// lit web components aren't pulled in until needed.

let initialized = false
let bcProvider = null // WebLN-compatible provider once connected
let onConnectHandler = null // single handler the wallet store registers

export async function initBitcoinConnect() {
  if (initialized) return
  const { init, onConnected, onDisconnected } = await import('@getalby/bitcoin-connect')
  init({ appName: 'Lunar', showBalance: true })
  // Fires on connect AND on auto-reconnect of a previously-connected wallet,
  // so the provider is restored after a reload.
  onConnected((provider) => {
    bcProvider = provider
    if (onConnectHandler) onConnectHandler(provider)
  })
  onDisconnected(() => {
    bcProvider = null
  })
  initialized = true
}

// The connected WebLN-compatible provider (or null).
export function getBitcoinConnectProvider() {
  return bcProvider
}

// Register a single callback fired when a wallet connects (replaces any prior).
export function setOnConnect(cb) {
  onConnectHandler = cb
}

// Open the Bitcoin Connect connect modal (choose/enter a wallet).
export async function launchConnect() {
  await initBitcoinConnect()
  const { launchModal } = await import('@getalby/bitcoin-connect')
  launchModal()
}

export async function disconnectBitcoinConnect() {
  if (!initialized) return
  const { disconnect } = await import('@getalby/bitcoin-connect')
  try {
    disconnect()
  } catch (_) {
    /* ignore */
  }
  bcProvider = null
}

// Open the Bitcoin Connect payment modal for a bolt11 invoice. Returns the
// modal handle ({ setPaid }); onPaid / onCancelled fire on completion.
export async function launchPayment({ invoice, onPaid, onCancelled }) {
  await initBitcoinConnect()
  const { launchPaymentModal } = await import('@getalby/bitcoin-connect')
  return launchPaymentModal({ invoice, onPaid, onCancelled })
}
