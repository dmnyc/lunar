<template>
  <q-page>
    <BaseHeader>wallet</BaseHeader>

    <div class='section flex column' style='gap: 1rem;'>
      <BaseWalletCard/>
      <BaseWalletConnect/>
    </div>

    <q-separator color='accent'/>

    <div class='section flex column' style='gap: .6rem;'>
      <div class="text-bold flex justify-between no-wrap items-center" style='font-size: 1.1rem;'>
        <span>zap defaults</span>
        <q-toggle
          :model-value='tips.enabled'
          color='accent'
          size='sm'
          @update:model-value='val => save("enabled", val)'
        />
      </div>

      <template v-if='tips.enabled'>
        <span style='white-space: nowrap;'><strong>tip presets</strong></span>
        <div class='flex row no-wrap items-center' style='gap: 1.5rem;'>
          <q-input
            v-for='(preset, index) in tips.presets'
            :key='index'
            :model-value='tips.presets[index]'
            type='number'
            dense
            outlined
            :label='"preset " + (index + 1)'
            style='max-width: 8rem;'
            @update:model-value='val => savePreset(index, val)'
          />
        </div>

        <span style='white-space: nowrap;'><strong>one click zap</strong></span>
        <div style='font-size: .9rem;'>
          when enabled, the <q-icon name='bolt' style='font-size: 1.2rem;'/> button zaps the default
          amount in one click using your connected wallet (or a WebLN extension). the dropdown arrow
          always opens the normal zap pay flow.
        </div>
        <div class='flex row no-wrap items-center' style='gap: 1.5rem;'>
          <q-toggle
            :model-value='tips.oneClick.enabled'
            label='enable one click zap'
            color='accent'
            size='sm'
            @update:model-value='val => saveOneClick({ enabled: val })'
          />
          <q-input
            v-if='tips.oneClick.enabled'
            :model-value='tips.oneClick.amount'
            type='number'
            dense
            outlined
            label='default amount (sats)'
            style='max-width: 11rem;'
            @update:model-value='val => saveOneClick({ amount: Number(val) || 0 })'
          />
        </div>
      </template>
    </div>
  </q-page>
</template>

<script>
import helpersMixin from '../utils/mixin'
import { createMetaMixin } from 'quasar'
import BaseWalletConnect from 'components/BaseWalletConnect.vue'
import BaseWalletCard from 'components/BaseWalletCard.vue'

const metaData = {
  title: 'astral - wallet',
  meta: {
    description: { name: 'description', content: 'Lightning wallet and zap settings on astral' },
    keywords: { name: 'keywords', content: 'nostr decentralized social media lightning zap' },
    equiv: { 'http-equiv': 'Content-Type', content: 'text/html; charset=UTF-8' },
  },
}

export default {
  name: 'Wallet',
  mixins: [helpersMixin, createMetaMixin(metaData)],
  components: { BaseWalletConnect, BaseWalletCard },

  data() {
    return {
      // local working copy; each edit is committed straight to the store
      tips: JSON.parse(JSON.stringify(this.$store.state.config.preferences.lightningTips)),
    }
  },

  methods: {
    save(key, value) {
      this.tips[key] = value
      this.$store.commit('setConfigLightningTips', { key, value })
    },
    savePreset(index, value) {
      const presets = [...this.tips.presets]
      presets[index] = Number(value) || 0
      this.tips.presets = presets
      this.$store.commit('setConfigLightningTips', { key: 'presets', value: presets })
    },
    saveOneClick(patch) {
      const oneClick = { ...this.tips.oneClick, ...patch }
      this.tips.oneClick = oneClick
      this.$store.commit('setConfigLightningTips', { key: 'oneClick', value: oneClick })
    },
  },
}
</script>

<style scoped>
.section {
  padding: 1rem;
}
</style>
