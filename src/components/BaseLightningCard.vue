<template>
  <div class='lightning-card'>
    <div class='flex column items-center' style='gap: 1rem;'>
      <div v-if='pubkey' class='flex column items-center'>
        <span class='text-bold' style='font-size: 1.1rem;'>lightning tip for</span>
        <BaseUserCard :pubkey='pubkey' :action-buttons='false'/>
      </div>
      <div v-else class='text-bold' style='font-size: 1.1rem;'>lightning {{ type }}</div>

      <!-- fixed bolt11 invoice details -->
      <div v-if='bolt11' class='flex column items-center' style='font-size: .9rem;'>
        <div v-if='bolt11.description'><strong>desc:</strong> {{ bolt11.description }}</div>
        <div><strong>amount:</strong> {{ bolt11.amount ? `${bolt11.amount} sats` : 'none specified' }}</div>
        <div v-if='bolt11.error' class='text-negative'><strong>error:</strong> {{ bolt11.error }}</div>
      </div>
      <div v-else-if='request.lnAddr' class='text-secondary'>{{ request.lnAddr }}</div>

      <!-- amount + message (lnurl tips) -->
      <div v-if='type === "lnurl"' class='flex column items-center' style='gap: .6rem; width: 100%;'>
        <div class='flex row items-center justify-center' style='gap: .4rem; flex-wrap: wrap;'>
          <q-btn
            v-for='amt in presets'
            :key='amt'
            :label='String(amt)'
            size='sm'
            :outline='amount !== amt'
            color='primary'
            :text-color='amount === amt ? "dark" : undefined'
            @click.stop='amount = amt'
          />
          <q-input v-model.number='amount' type='number' dense outlined label='sats' style='max-width: 6rem;'/>
        </div>
        <q-input
          v-model='zapMessage'
          dense
          outlined
          autogrow
          label='message (optional)'
          style='width: 100%; max-width: 20rem;'
          maxlength='140'
          @click.stop
        />
      </div>

      <!-- pay via Bitcoin Connect (WebLN / NWC / Alby, with its own QR) -->
      <div class='flex column items-center' style='gap: .25rem;'>
        <q-btn
          :label='payLabel'
          icon='bolt'
          color='primary'
          text-color='dark'
          unelevated
          :loading='paying'
          :disable='type === "lnurl" && !amount'
          @click.stop='pay'
        />
        <span v-if='walletName' class='text-caption' style='opacity: .55;'>via {{ walletName }}</span>
      </div>

      <!-- raw lnurl/invoice QR for scanning with any wallet -->
      <q-btn :label='showQr ? "hide QR" : "show QR"' icon='qr_code_2' flat dense size='sm' @click.stop='showQr = !showQr'/>
      <BaseQr v-if='showQr' :code='lnString' style='height: fit-content;'/>
    </div>
  </div>
</template>

<script>
import helpersMixin from '../utils/mixin'
import BaseQr from 'components/BaseQr'
import * as bolt11Parser from 'light-bolt11-decoder'
import { utils } from 'lnurl-pay'
import { Notify } from 'quasar'
import { launchPayment } from '../nostr/wallet/bitcoinConnect'
import { useWalletStore } from 'stores/wallet'

export default {
  name: 'BaseLightningCard',
  mixins: [helpersMixin],
  emits: ['paid'],
  props: {
    lnString: { type: String, required: true },
    pubkey: { type: String, default: null },
    rowOrColumn: { type: String, default: 'column' }
  },
  components: {
    BaseQr,
  },

  data() {
    return {
      request: {},
      amount: this.$store.state.config.preferences.lightningTips.presets[0],
      zapMessage: '',
      paying: false,
      showQr: false,
    }
  },

  computed: {
    bolt11() {
      if (!this.lnString.toLowerCase().startsWith('lnbc')) return null
      try {
        let inv = bolt11Parser.decode(this.lnString)
        let sections = {}
        inv.sections.forEach(({ name, value }) => { sections[name] = value })
        return {
          amount: sections.amount ? sections.amount / 1000 : null,
          description: sections.description,
          request: inv.paymentRequest
        }
      } catch (error) {
        return { error, request: this.lnString }
      }
    },
    type() {
      return this.lnString.startsWith('lnbc') ? 'invoice' : 'lnurl'
    },
    presets() {
      return this.$store.state.config.preferences.lightningTips.presets
    },
    payLabel() {
      return this.type === 'lnurl' ? `tip ${this.amount || 0}` : 'pay'
    },
    walletName() {
      const wallet = useWalletStore()
      return wallet.connected ? wallet.activeWallet?.name || null : null
    },
  },

  async mounted() {
    if (this.bolt11) return
    if (!utils.isLnurl(this.lnString)) {
      this.request.error = 'invalid lnurl'
      return
    }
    let lnAddr = this.lnurlToLnAddr(this.lnString)
    if (lnAddr) this.request.lnAddr = lnAddr
  },

  methods: {
    async pay() {
      if (this.paying) return
      if (this.type === 'lnurl' && !this.amount) return
      this.paying = true
      try {
        let invoice = this.lnString
        if (this.type === 'lnurl') {
          invoice = await this.getInvoice(this.lnString, this.amount, this.pubkey, null, this.zapMessage)
          if (!invoice || !invoice.toLowerCase().startsWith('lnbc')) {
            throw new Error('could not fetch an invoice for this user')
          }
        }

        const wallet = useWalletStore()
        if (wallet.connected) {
          // Use the onboard NWC/WebLN wallet directly — no modal needed.
          await wallet.payInvoice(invoice)
          Notify.create({ message: this.type === 'lnurl' ? 'tipped ⚡' : 'payment sent ⚡' })
          this.$emit('paid')
        } else {
          // No onboard wallet — fall back to the Bitcoin Connect modal.
          await launchPayment({
            invoice,
            onPaid: () => {
              Notify.create({ message: this.type === 'lnurl' ? 'tipped ⚡' : 'payment sent ⚡' })
              this.paying = false
              this.$emit('paid')
            },
            onCancelled: () => { this.paying = false },
          })
        }
      } catch (e) {
        Notify.create({ message: `payment failed: ${e?.message || e}`, color: 'negative' })
      } finally {
        this.paying = false
      }
    },
  },
}
</script>

<style lang='scss' scoped>
.lightning-card {
  background: var(--q-background);
  border: 3px double var(--q-accent);
  padding: .5rem;
  margin: .3rem;
}
.q-btn {
  transition: all .3s ease-in-out;
}
</style>
