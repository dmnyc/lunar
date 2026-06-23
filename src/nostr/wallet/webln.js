// WebLN provider — the active provider is either a Bitcoin Connect connection
// (WebLN/NWC/Alby chosen in its modal) or a raw browser extension (window.webln).

import { getBitcoinConnectProvider } from './bitcoinConnect'

function activeProvider() {
  return getBitcoinConnectProvider() || (typeof window !== 'undefined' ? window.webln : null)
}

// True when a raw browser extension is present (drives the "connect browser
// wallet" button — Bitcoin Connect is offered separately).
export function isWeblnAvailable() {
  return typeof window !== 'undefined' && typeof window.webln !== 'undefined'
}

async function enable() {
  const p = activeProvider()
  if (!p) throw new Error('no lightning wallet available')
  if (typeof p.enable === 'function') await p.enable()
  return p
}

export async function payWeblnInvoice(invoice) {
  const p = await enable()
  const res = await p.sendPayment(invoice)
  return { preimage: res?.preimage }
}

export async function getWeblnBalance() {
  const p = await enable()
  if (typeof p.getBalance !== 'function') return null
  try {
    const res = await p.getBalance()
    return typeof res?.balance === 'number' ? Math.floor(res.balance) : null
  } catch (_) {
    return null
  }
}

export async function createWeblnInvoice(amountSats, description) {
  const p = await enable()
  if (typeof p.makeInvoice !== 'function') throw new Error('this wallet cannot create invoices')
  const res = await p.makeInvoice({ amount: amountSats, defaultMemo: description || '' })
  return { invoice: res.paymentRequest }
}
