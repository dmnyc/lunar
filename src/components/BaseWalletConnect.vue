<template>
  <div class='full-width flex column' style='gap: .6rem;'>
    <div class="text-bold flex justify-between no-wrap items-center" style='font-size: 1.1rem;'>
      <span>wallet</span>
      <q-btn
        v-if='wallet.connected'
        flat
        dense
        size='sm'
        :icon='wallet.balanceVisible ? "visibility" : "visibility_off"'
        @click='toggleBalance'
      >
        <q-tooltip>show/hide balance</q-tooltip>
      </q-btn>
    </div>

    <!-- connected wallets -->
    <div v-if='wallet.wallets.length' class='flex column' style='gap: .4rem;'>
      <div
        v-for='w in wallet.wallets'
        :key='w.id'
        class='flex row no-wrap items-center justify-between q-pa-sm wallet-row'
        :class='{ "wallet-row--active": w.active }'
      >
        <div class='flex row no-wrap items-center' style='gap: .5rem; overflow: hidden;'>
          <q-icon :name='kindIcon(w.kind)' size='sm' :color='w.active ? "positive" : "secondary"'/>
          <div class='flex column' style='overflow: hidden;'>
            <span class='ellipsis' style='max-width: 16rem;'>{{ w.name }}</span>
            <span class='text-secondary' style='font-size: .75rem;'>{{ kindName(w.kind) }}</span>
          </div>
        </div>
        <div class='flex row no-wrap items-center' style='gap: .2rem;'>
          <q-btn v-if='!w.active' size='sm' flat dense label='use' @click='wallet.setActiveWallet(w.id)'/>
          <span v-else-if='wallet.balanceVisible && wallet.balance != null' class='q-px-xs' style='font-size: .9rem;'>
            {{ wallet.balance.toLocaleString() }} sats
          </span>
          <q-btn size='sm' flat dense round icon='close' color='negative' @click='wallet.removeWallet(w.id)'>
            <q-tooltip>remove</q-tooltip>
          </q-btn>
        </div>
      </div>
      <div class='flex row' style='gap: .4rem;'>
        <q-btn size='sm' outline color='primary' icon='refresh' label='refresh balance' :loading='wallet.loading' @click='refresh'/>
      </div>
    </div>

    <!-- connect new wallet -->
    <div class='flex column' style='gap: .4rem;'>
      <div class='flex row no-wrap items-center' style='gap: .3rem;'>
        <q-input
          v-model='nwcString'
          dense
          outlined
          class='col'
          label='nostr+walletconnect://… (NWC)'
        />
        <q-btn size='sm' color='positive' label='connect' :loading='connecting' :disable='!nwcString' @click='connectNwc'/>
      </div>
      <span class='text-secondary' style='font-size: .75rem;'>paste a connection string from Alby Hub, Yakihonne, Rizful, or Minibits</span>
      <div class='flex row' style='gap: .4rem;'>
        <q-btn v-if='hasWebln' size='sm' outline color='primary' icon='extension' label='connect browser wallet (WebLN)' @click='connectWebln'/>
        <q-btn size='sm' outline color='secondary' icon='hourglass_empty' label='Spark (coming soon)' disable/>
      </div>
      <span v-if='error' class='text-negative' style='font-size: .8rem;'>{{ error }}</span>
    </div>
  </div>
</template>

<script>
import { defineComponent } from 'vue'
import { Notify } from 'quasar'
import { useWalletStore, WALLET_WEBLN, WALLET_NWC, WALLET_SPARK } from 'stores/wallet'
import { isWeblnAvailable } from '../nostr/wallet/webln'

export default defineComponent({
  name: 'BaseWalletConnect',

  setup() {
    return { wallet: useWalletStore() }
  },

  data() {
    return {
      nwcString: '',
      connecting: false,
      error: '',
      hasWebln: isWeblnAvailable(),
    }
  },

  mounted() {
    if (this.wallet.connected) this.refresh()
  },

  methods: {
    kindName(kind) {
      if (kind === WALLET_WEBLN) return 'browser extension'
      if (kind === WALLET_NWC) return 'Nostr Wallet Connect'
      if (kind === WALLET_SPARK) return 'self-custodial (Spark)'
      return 'wallet'
    },
    kindIcon(kind) {
      if (kind === WALLET_WEBLN) return 'extension'
      if (kind === WALLET_NWC) return 'bolt'
      if (kind === WALLET_SPARK) return 'savings'
      return 'account_balance_wallet'
    },
    async connectNwc() {
      this.error = ''
      this.connecting = true
      try {
        await this.wallet.connectNwcWallet(this.nwcString.trim())
        this.nwcString = ''
        Notify.create({ message: 'wallet connected ⚡' })
        this.refresh()
      } catch (e) {
        this.error = e?.message || 'could not connect wallet'
      } finally {
        this.connecting = false
      }
    },
    connectWebln() {
      this.error = ''
      try {
        this.wallet.connectWeblnWallet()
        Notify.create({ message: 'browser wallet connected ⚡' })
        this.refresh()
      } catch (e) {
        this.error = e?.message || 'could not connect browser wallet'
      }
    },
    refresh() {
      this.wallet.refreshBalance()
    },
    toggleBalance() {
      this.wallet.toggleBalanceVisible()
    },
  },
})
</script>

<style scoped>
.wallet-row {
  border: 1px solid var(--q-accent);
  border-radius: .4rem;
}
.wallet-row--active {
  border-color: var(--q-primary);
}
</style>
