import { defineStore } from 'pinia'
import { LocalStorage } from 'quasar'
import {
  connectNwc,
  disconnectNwc,
  isNwcConnected,
  payNwcInvoice,
  createNwcInvoice,
  getNwcBalance,
  getNwcDisplayName,
  isValidNwcUrl
} from '../nostr/wallet/nwc'
import {
  isWeblnAvailable,
  payWeblnInvoice,
  createWeblnInvoice,
  getWeblnBalance
} from '../nostr/wallet/webln'
import { listNwcTransactions } from '../nostr/wallet/nwc'
import { fetchLnurlInvoice } from '../nostr/zap'

// Wallet kinds (matches the zapcooking/sparkihonne convention)
export const WALLET_WEBLN = 1
export const WALLET_NWC = 3
export const WALLET_SPARK = 4

const STORAGE_KEY = 'astral_wallets'

export const useWalletStore = defineStore('wallet', {
  state: () => ({
    wallets: LocalStorage.getItem(STORAGE_KEY) || [], // [{id, kind, name, active, data}]
    balance: null, // sats
    loading: false,
    lastSync: null,
    transactions: [],
    txLoading: false,
    balanceVisible: LocalStorage.getItem('astral_balance_visible') !== false
  }),

  getters: {
    activeWallet: (state) => state.wallets.find((w) => w.active) || null,
    connected: (state) => state.wallets.some((w) => w.active),
    hasKind: (state) => (kind) => state.wallets.some((w) => w.kind === kind)
  },

  actions: {
    persist() {
      LocalStorage.set(STORAGE_KEY, JSON.parse(JSON.stringify(this.wallets)))
    },

    addWallet(kind, name, data) {
      const wallet = { id: Date.now(), kind, name, active: this.wallets.length === 0, data }
      this.wallets.push(wallet)
      this.persist()
      return wallet
    },

    removeWallet(id) {
      this.wallets = this.wallets.filter((w) => w.id !== id)
      if (this.wallets.length && !this.wallets.some((w) => w.active)) this.wallets[0].active = true
      this.persist()
      this.balance = null
      this.lastSync = null
    },

    setActiveWallet(id) {
      this.wallets = this.wallets.map((w) => ({ ...w, active: w.id === id }))
      this.persist()
      this.balance = null
      this.lastSync = null
    },

    toggleBalanceVisible() {
      this.balanceVisible = !this.balanceVisible
      LocalStorage.set('astral_balance_visible', this.balanceVisible)
    },

    // ── connecting wallets ──────────────────────────────────────────────

    // Connect a NWC wallet from a nostr+walletconnect:// string.
    async connectNwcWallet(connectionUrl) {
      if (!isValidNwcUrl(connectionUrl)) throw new Error('Invalid NWC connection string')
      await connectNwc(connectionUrl)
      const existing = this.wallets.find((w) => w.kind === WALLET_NWC && w.data === connectionUrl)
      if (existing) {
        this.setActiveWallet(existing.id)
        return existing
      }
      return this.addWallet(WALLET_NWC, getNwcDisplayName(connectionUrl), connectionUrl)
    },

    // Add the browser WebLN wallet.
    connectWeblnWallet() {
      if (!isWeblnAvailable()) throw new Error('No WebLN provider (browser extension) detected')
      const existing = this.wallets.find((w) => w.kind === WALLET_WEBLN)
      if (existing) {
        this.setActiveWallet(existing.id)
        return existing
      }
      return this.addWallet(WALLET_WEBLN, 'Browser extension (WebLN)', 'webln')
    },

    // Re-establish the live connection for the active wallet (called lazily
    // before payments; NWC needs its relay connected, WebLN needs enable()).
    async ensureActiveConnected() {
      const w = this.activeWallet
      if (!w) throw new Error('No active wallet')
      if (w.kind === WALLET_NWC && !isNwcConnected()) await connectNwc(w.data)
      if (w.kind === WALLET_SPARK) throw new Error('Spark wallet support is coming soon')
    },

    // ── payments ────────────────────────────────────────────────────────

    async payInvoice(invoice) {
      const w = this.activeWallet
      if (!w) throw new Error('No active wallet')
      await this.ensureActiveConnected()
      if (w.kind === WALLET_NWC) return payNwcInvoice(invoice)
      if (w.kind === WALLET_WEBLN) return payWeblnInvoice(invoice)
      throw new Error('Unsupported wallet')
    },

    async createInvoice(amountSats, description) {
      const w = this.activeWallet
      if (!w) throw new Error('No active wallet')
      await this.ensureActiveConnected()
      if (w.kind === WALLET_NWC) return createNwcInvoice(amountSats, description)
      if (w.kind === WALLET_WEBLN) return createWeblnInvoice(amountSats, description)
      throw new Error('Unsupported wallet')
    },

    // Pay either a bolt11 invoice or a lightning address / LNURL (with amount).
    async pay(input, amountSats) {
      const s = (input || '').trim()
      if (!s) throw new Error('nothing to pay')
      let invoice = s
      if (!s.toLowerCase().startsWith('lnbc')) {
        invoice = await fetchLnurlInvoice(s, amountSats)
      }
      const result = await this.payInvoice(invoice)
      this.refreshBalance()
      return result
    },

    async loadTransactions(limit = 20) {
      const w = this.activeWallet
      if (!w || w.kind !== WALLET_NWC) {
        this.transactions = []
        return []
      }
      this.txLoading = true
      try {
        await this.ensureActiveConnected()
        this.transactions = await listNwcTransactions({ limit })
        return this.transactions
      } catch (e) {
        console.error('[wallet] loadTransactions failed', e)
        return []
      } finally {
        this.txLoading = false
      }
    },

    async refreshBalance() {
      const w = this.activeWallet
      if (!w) return null
      this.loading = true
      try {
        await this.ensureActiveConnected()
        let balance = null
        if (w.kind === WALLET_NWC) balance = await getNwcBalance()
        else if (w.kind === WALLET_WEBLN) balance = await getWeblnBalance()
        this.balance = balance
        this.lastSync = Math.round(Date.now() / 1000)
        return balance
      } catch (e) {
        console.error('[wallet] refreshBalance failed', e)
        return null
      } finally {
        this.loading = false
      }
    },

    async disconnectAll() {
      await disconnectNwc()
      this.wallets = []
      this.balance = null
      this.lastSync = null
      this.persist()
    }
  }
})
