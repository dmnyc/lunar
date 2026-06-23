<template>
  <div class='full-width flex column' style='gap: .6rem;'>
    <!-- connected wallet: name + disconnect (with confirmation) -->
    <div v-if='wallet.wallets.length' class='flex column' style='gap: .4rem;'>
      <div
        v-for='w in wallet.wallets'
        :key='w.id'
        class='flex row no-wrap items-center justify-between q-pa-sm wallet-row wallet-row--active'
      >
        <div class='flex row no-wrap items-center' style='gap: .5rem; overflow: hidden;'>
          <q-icon :name='kindIcon(w.kind)' size='sm' color='positive'/>
          <div class='flex column' style='overflow: hidden;'>
            <span class='ellipsis' style='max-width: 16rem;'>{{ w.name }}</span>
            <span class='text-secondary' style='font-size: .75rem;'>{{ kindName(w.kind) }}</span>
          </div>
        </div>
        <q-btn size='sm' outline dense color='negative' label='disconnect' @click='confirmDisconnect(w)'/>
      </div>
      <div v-if='activeIsNwc' class='flex row' style='gap: .4rem;'>
        <q-btn size='sm' flat dense icon='cloud_upload' label='back up to nostr' :loading='backingUp' @click='backupToNostr'/>
      </div>
    </div>

    <!-- connect a wallet (hidden once one is connected) -->
    <div v-else class='flex column' style='gap: .4rem;'>
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
      <q-btn size='sm' flat dense icon='cloud_download' label='restore from nostr backup' :loading='restoring' @click='restoreFromNostr'/>
      <span v-if='error' class='text-negative' style='font-size: .8rem;'>{{ error }}</span>
    </div>
  </div>
</template>

<script>
import { defineComponent } from 'vue'
import { Notify } from 'quasar'
import { useWalletStore, WALLET_WEBLN, WALLET_NWC, WALLET_SPARK } from 'stores/wallet'
import { isWeblnAvailable } from '../nostr/wallet/webln'
import { backupNwcToNostr, restoreNwcFromNostr, canBackup } from '../nostr/wallet/nwcBackup'

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
      backingUp: false,
      restoring: false,
    }
  },

  computed: {
    activeIsNwc() {
      return this.wallet.activeWallet?.kind === WALLET_NWC
    },
  },

  methods: {
    async backupToNostr() {
      this.error = ''
      this.backingUp = true
      try {
        await backupNwcToNostr(this.$store, this.wallet.activeWallet.data)
        Notify.create({ message: 'wallet backed up to nostr ✓' })
      } catch (e) {
        this.error = e?.message || 'backup failed'
      } finally {
        this.backingUp = false
      }
    },
    async restoreFromNostr() {
      this.error = ''
      this.restoring = true
      try {
        const conn = await restoreNwcFromNostr(this.$store)
        if (!conn) {
          this.error = 'no backup found on your relays'
          return
        }
        await this.wallet.connectNwcWallet(conn)
        Notify.create({ message: 'wallet restored from nostr ⚡' })
        this.wallet.refreshBalance()
      } catch (e) {
        this.error = e?.message || 'restore failed'
      } finally {
        this.restoring = false
      }
    },
    confirmDisconnect(w) {
      this.$q.dialog({
        title: 'disconnect wallet',
        message: `disconnect "${w.name}"? you can reconnect anytime with your connection string.`,
        cancel: true,
        persistent: true,
        ok: { label: 'disconnect', color: 'negative', flat: true },
        cancel: { label: 'cancel', flat: true },
      }).onOk(() => {
        this.wallet.removeWallet(w.id)
        Notify.create({ message: 'wallet disconnected' })
      })
    },
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
        const conn = this.nwcString.trim()
        await this.wallet.connectNwcWallet(conn)
        this.nwcString = ''
        Notify.create({ message: 'wallet connected ⚡' })
        this.wallet.refreshBalance()
        this.offerBackup(conn)
      } catch (e) {
        this.error = e?.message || 'could not connect wallet'
      } finally {
        this.connecting = false
      }
    },
    // After connecting, offer to back the connection up to Nostr so it can be
    // restored on another device / after clearing storage.
    offerBackup(connectionString) {
      if (!canBackup(this.$store)) return
      this.$q.dialog({
        title: 'back up to nostr?',
        message:
          'Encrypt this wallet connection to your Nostr key and store it on your relays, so you can restore it later without the connection string.',
        cancel: { label: 'not now', flat: true },
        ok: { label: 'back up', color: 'primary' },
        persistent: false,
      }).onOk(async () => {
        try {
          await backupNwcToNostr(this.$store, connectionString)
          Notify.create({ message: 'wallet backed up to nostr ✓' })
        } catch (e) {
          Notify.create({ message: `backup failed: ${e?.message || e}`, color: 'negative' })
        }
      })
    },
    connectWebln() {
      this.error = ''
      try {
        this.wallet.connectWeblnWallet()
        Notify.create({ message: 'browser wallet connected ⚡' })
        this.wallet.refreshBalance()
      } catch (e) {
        this.error = e?.message || 'could not connect browser wallet'
      }
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
