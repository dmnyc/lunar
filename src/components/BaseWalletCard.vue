<template>
  <div v-if='wallet.connected'>
    <!-- compact: sidebar balance pill -->
    <div
      v-if='compact'
      class='wallet-pill flex row no-wrap items-center justify-between q-px-sm q-py-xs'
      @click='$router.push("/wallet")'
    >
      <q-icon name='bolt' color='accent' size='sm'/>
      <span v-if='wallet.balanceVisible' class='text-bold'>{{ balanceLabel }}</span>
      <span v-else class='text-bold'>••••</span>
      <q-icon
        :name='wallet.balanceVisible ? "visibility" : "visibility_off"'
        size='xs'
        @click.stop='wallet.toggleBalanceVisible()'
      />
    </div>

    <!-- full balance card -->
    <div v-else class='wallet-card flex column' style='gap: .8rem;'>
      <div class='flex row no-wrap items-center justify-between'>
        <div class='flex column'>
          <span class='text-secondary' style='font-size: .8rem;'>balance</span>
          <div class='flex row no-wrap items-baseline' style='gap: .3rem;'>
            <span class='balance-amount'>{{ wallet.balanceVisible ? balanceLabel : '••••' }}</span>
            <span class='text-secondary'>sats</span>
          </div>
        </div>
        <div class='flex row' style='gap: .2rem;'>
          <q-btn flat round dense :icon='wallet.balanceVisible ? "visibility" : "visibility_off"' @click='wallet.toggleBalanceVisible()'>
            <q-tooltip>show/hide balance</q-tooltip>
          </q-btn>
          <q-btn flat round dense icon='refresh' :loading='wallet.loading' @click='refresh'>
            <q-tooltip>refresh</q-tooltip>
          </q-btn>
        </div>
      </div>

      <div class='flex row' style='gap: .5rem;'>
        <q-btn class='col' unelevated color='primary' text-color='dark' icon='arrow_upward' label='send' @click='openSend'/>
        <q-btn class='col' unelevated color='primary' text-color='dark' icon='arrow_downward' label='receive' @click='openReceive'/>
      </div>

      <!-- transaction history -->
      <div class='flex column' style='gap: .3rem;'>
        <div class='flex row no-wrap items-center justify-between'>
          <span class='text-bold'>recent activity</span>
          <q-btn flat dense size='sm' icon='refresh' :loading='wallet.txLoading' @click='loadTx'/>
        </div>
        <div v-if='!wallet.transactions.length' class='text-secondary' style='font-size: .85rem;'>
          {{ wallet.txLoading ? 'loading…' : 'no transactions yet' }}
        </div>
        <div
          v-for='(tx, i) in txs'
          :key='i'
          class='flex row no-wrap items-center justify-between q-py-xs tx-row'
        >
          <div class='flex row no-wrap items-center' style='gap: .5rem; overflow: hidden;'>
            <q-icon
              :name='tx.type === "incoming" ? "arrow_downward" : "arrow_upward"'
              :color='tx.type === "incoming" ? "positive" : "secondary"'
              size='sm'
            />
            <BaseUserAvatar v-if='tx.pubkey' :pubkey='tx.pubkey' size='1.6rem'/>
            <div class='flex column' style='overflow: hidden;'>
              <span class='ellipsis' style='max-width: 13rem;'>{{ txLabel(tx) }}</span>
              <span class='text-secondary' style='font-size: .7rem;'>{{ txDate(tx) }}</span>
            </div>
          </div>
          <span :class='tx.type === "incoming" ? "text-positive" : ""' style='white-space: nowrap;'>
            <template v-if='wallet.balanceVisible'>{{ tx.type === 'incoming' ? '+' : '-' }}{{ tx.amount.toLocaleString() }}</template>
            <template v-else>••••</template>
          </span>
        </div>
      </div>
    </div>

    <!-- send dialog -->
    <q-dialog v-model='sendOpen'>
      <q-card class='dialog-card flex column' style='gap: .6rem; padding: 1rem; min-width: 300px;'>
        <div class='text-bold' style='font-size: 1.1rem;'>send</div>
        <q-input v-model='sendInput' dense outlined autogrow label='invoice or lightning address'/>
        <q-input v-if='!sendIsInvoice' v-model.number='sendAmount' dense outlined type='number' label='amount (sats)'/>
        <span v-if='sendError' class='text-negative' style='font-size: .8rem;'>{{ sendError }}</span>
        <div class='flex row justify-end' style='gap: .4rem;'>
          <q-btn flat label='cancel' v-close-popup/>
          <q-btn unelevated color='primary' text-color='dark' label='pay' :loading='sending' :disable='!sendInput' @click='doSend'/>
        </div>
      </q-card>
    </q-dialog>

    <!-- receive dialog -->
    <q-dialog v-model='receiveOpen'>
      <q-card class='dialog-card flex column items-center' style='gap: .6rem; padding: 1rem; min-width: 300px;'>
        <div class='text-bold full-width' style='font-size: 1.1rem;'>receive</div>
        <template v-if='!receiveInvoice'>
          <q-input v-model.number='receiveAmount' dense outlined type='number' label='amount (sats)' class='full-width'/>
          <q-input v-model='receiveMemo' dense outlined label='memo (optional)' class='full-width'/>
          <span v-if='receiveError' class='text-negative' style='font-size: .8rem;'>{{ receiveError }}</span>
          <div class='flex row justify-end full-width' style='gap: .4rem;'>
            <q-btn flat label='cancel' v-close-popup/>
            <q-btn unelevated color='primary' text-color='dark' label='create invoice' :loading='creating' :disable='!receiveAmount' @click='doReceive'/>
          </div>
        </template>
        <template v-else>
          <BaseQr :code='receiveInvoice' style='height: fit-content;'/>
          <q-btn outline color='primary' icon='content_copy' label='copy invoice' @click='copyInvoice'/>
          <q-btn flat label='done' v-close-popup @click='resetReceive'/>
        </template>
      </q-card>
    </q-dialog>
  </div>
</template>

<script>
import { defineComponent } from 'vue'
import { Notify, copyToClipboard, date } from 'quasar'
import { useWalletStore } from 'stores/wallet'
import BaseQr from 'components/BaseQr.vue'

export default defineComponent({
  name: 'BaseWalletCard',
  components: { BaseQr },
  props: {
    compact: { type: Boolean, default: false },
  },

  setup() {
    return { wallet: useWalletStore() }
  },

  data() {
    return {
      sendOpen: false,
      sendInput: '',
      sendAmount: null,
      sending: false,
      sendError: '',
      receiveOpen: false,
      receiveAmount: null,
      receiveMemo: '',
      receiveInvoice: '',
      creating: false,
      receiveError: '',
    }
  },

  computed: {
    balanceLabel() {
      return this.wallet.balance != null ? this.wallet.balance.toLocaleString() : '—'
    },
    sendIsInvoice() {
      return this.sendInput.trim().toLowerCase().startsWith('lnbc')
    },
    // Enrich transactions with the counterparty nostr pubkey parsed from the
    // zap request (NIP-57 puts the kind-9734 JSON in the invoice description).
    txs() {
      return this.wallet.transactions.map((tx) => ({ ...tx, pubkey: this.zapCounterparty(tx) }))
    },
  },

  mounted() {
    if (this.wallet.connected && !this.compact) {
      this.refresh()
      this.loadTx()
    } else if (this.wallet.connected) {
      this.refresh()
    }
  },

  methods: {
    refresh() {
      this.wallet.refreshBalance()
    },
    async loadTx() {
      await this.wallet.loadTransactions()
      // warm profiles for any zap counterparties so avatars/names render
      const seen = new Set()
      for (const tx of this.wallet.transactions) {
        const pk = this.zapCounterparty(tx)
        if (pk && !seen.has(pk)) {
          seen.add(pk)
          this.$store.dispatch('useProfile', { pubkey: pk })
        }
      }
    },
    // Counterparty pubkey of a zap: the sender for incoming, the recipient
    // (p tag) for outgoing. null for plain (non-zap) payments.
    zapCounterparty(tx) {
      try {
        const req = JSON.parse(tx.description)
        if (!req || req.kind !== 9734) return null
        if (tx.type === 'incoming') return req.pubkey
        const p = (req.tags || []).find((t) => t[0] === 'p')
        return p ? p[1] : null
      } catch (_) {
        return null
      }
    },
    txLabel(tx) {
      if (tx.pubkey) {
        const name = this.$store.getters.displayName(tx.pubkey)
        return tx.type === 'incoming' ? `zap from ${name}` : `zap to ${name}`
      }
      return tx.description || (tx.type === 'incoming' ? 'received' : 'sent')
    },
    txDate(tx) {
      const ts = (tx.settledAt || tx.createdAt) * 1000
      if (!ts) return ''
      return date.formatDate(ts, 'MMM D, HH:mm')
    },
    openSend() {
      this.sendInput = ''
      this.sendAmount = null
      this.sendError = ''
      this.sendOpen = true
    },
    async doSend() {
      this.sendError = ''
      this.sending = true
      try {
        await this.wallet.pay(this.sendInput, this.sendAmount)
        Notify.create({ message: 'payment sent ⚡' })
        this.sendOpen = false
      } catch (e) {
        this.sendError = e?.message || 'payment failed'
      } finally {
        this.sending = false
      }
    },
    openReceive() {
      this.receiveAmount = null
      this.receiveMemo = ''
      this.receiveInvoice = ''
      this.receiveError = ''
      this.receiveOpen = true
    },
    async doReceive() {
      this.receiveError = ''
      this.creating = true
      try {
        const { invoice } = await this.wallet.createInvoice(this.receiveAmount, this.receiveMemo)
        this.receiveInvoice = invoice
      } catch (e) {
        this.receiveError = e?.message || 'could not create invoice'
      } finally {
        this.creating = false
      }
    },
    resetReceive() {
      this.receiveInvoice = ''
    },
    copyInvoice() {
      copyToClipboard(this.receiveInvoice).then(() => Notify.create({ message: 'invoice copied' }))
    },
  },
})
</script>

<style scoped>
.wallet-card {
  border: 1px solid var(--q-accent);
  border-radius: .6rem;
  padding: 1rem;
}
.balance-amount {
  font-size: 1.8rem;
  font-weight: 600;
}
.tx-row {
  border-top: 1px solid var(--q-accent);
}
.wallet-pill {
  border: 1px solid var(--q-accent);
  border-radius: .5rem;
  gap: .4rem;
  cursor: pointer;
}
.wallet-pill:hover {
  border-color: var(--q-primary);
}
.dialog-card {
  background: var(--q-background);
}
</style>
