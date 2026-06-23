<template>
  <q-btn-group class='no-padding' flat>
  <q-btn
    v-if="lnString && this.$store.state.config.preferences.lightningTips.enabled"
    icon="bolt"
    class='button-lightning'
    :class='(oneClick ? "q-pr-none q-pl-sm" : "")'
    @click.stop='handleLightningTipClick'
    align="left"
    :size='size'
    unelevated
    :ripple='false'
    dense
    :disable='loading'
  >
    <q-tooltip v-if='!loading'>
      tip with bitcoin lightning network
    </q-tooltip>
    <q-dialog v-model="showLightningCard">
      <BaseLightningCard :ln-string='lnString' :pubkey='pubkey' style='padding: 1.5rem;'/>
    </q-dialog>
  </q-btn>
  <q-btn v-if='oneClick' icon='arrow_drop_down' class='no-padding' dense unelevated :size='size' @click.stop="showLightningCard=!showLightningCard">
  </q-btn>
  </q-btn-group>
</template>

<script>
import { defineComponent } from 'vue'
import helpersMixin from '../utils/mixin'
import BaseLightningCard from 'components/BaseLightningCard.vue'
import {Notify} from 'quasar'
import { useWalletStore } from 'stores/wallet'

export default defineComponent({
  name: 'BaseButtonLightning',
  mixins: [helpersMixin],
  components: {
    BaseLightningCard
  },

  data() {
    return {
      showLightningCard: false,
      oneClick: this.$store.state.config.preferences.lightningTips.oneClick.enabled,
      amount: this.$store.state.config.preferences.lightningTips.oneClick.amount,
      lnString: this.$store.getters.profileLud06(this.pubkey),
      loading: false,
    }
  },

  props: {
    pubkey: {type: String, required: true},
    size: {
      type: String,
      required: false,
      default: 'sm',
    },
    // verbose: {
    //   type: Boolean,
    //   default: false
    // }
  },

  methods: {
    handleLightningTipClick() {
      const wallet = useWalletStore()
      const oneClickOn = this.$store.state.config.preferences.lightningTips.oneClick.enabled
      // One-click pays directly when a wallet (connected NWC/Spark) or WebLN is
      // available; otherwise open the amount/wallet picker.
      if (oneClickOn && (wallet.connected || window.webln)) this.sendTip()
      else this.showLightningCard = !this.showLightningCard
    },
    async sendTip() {
      this.loading = true
      try {
        const wallet = useWalletStore()
        const invoice = await this.getInvoice(this.lnString, this.amount, this.pubkey)
        if (!invoice || !invoice.toLowerCase().startsWith('lnbc')) {
          Notify.create({
            message: `invoice couldn't be fetched for ${this.$store.getters.displayName(this.pubkey)}, please use a different pay method`,
            color: 'negative'
          })
          return
        }

        if (wallet.connected) {
          await wallet.payInvoice(invoice)
        } else if (window.webln) {
          await window.webln.enable()
          await window.webln.sendPayment(invoice)
        } else {
          this.showLightningCard = true
          return
        }
        Notify.create({
          message: `${this.amount} sats zapped to ${this.$store.getters.displayName(this.pubkey)} ⚡`
        })
      } catch (e) {
        Notify.create({ message: `tip unsuccessful: ${e?.message || e}`, color: 'negative' })
      } finally {
        this.loading = false
      }
    }
  }
})
</script>


<style>
.button-lightning {
  opacity: .7;
  transition: all .3s ease-in-out;
}
.button-lightning:hover {
  opacity: 1;
}
</style>
