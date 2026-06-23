// WebLN provider (browser extension wallets like Alby).

export function isWeblnAvailable() {
  return typeof window !== 'undefined' && typeof window.webln !== 'undefined'
}

async function enable() {
  if (!isWeblnAvailable()) throw new Error('WebLN not available')
  await window.webln.enable()
  return window.webln
}

export async function payWeblnInvoice(invoice) {
  const webln = await enable()
  const res = await webln.sendPayment(invoice)
  return { preimage: res?.preimage }
}

export async function getWeblnBalance() {
  const webln = await enable()
  if (typeof webln.getBalance !== 'function') return null
  try {
    const res = await webln.getBalance()
    // WebLN getBalance returns { balance, currency } in the wallet's unit (sats).
    return typeof res?.balance === 'number' ? Math.floor(res.balance) : null
  } catch (_) {
    return null
  }
}

export async function createWeblnInvoice(amountSats, description) {
  const webln = await enable()
  if (typeof webln.makeInvoice !== 'function') throw new Error('WebLN cannot create invoices')
  const res = await webln.makeInvoice({ amount: amountSats, defaultMemo: description || '' })
  return { invoice: res.paymentRequest }
}
