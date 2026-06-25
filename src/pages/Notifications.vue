<template>
  <q-page>
    <BaseHeader>{{ $t('notifications') }}</BaseHeader>

    <BaseButtonLoadMore
      v-if='pendingCount'
      :loading-more='false'
      :label='"load " + pendingCount + " new"'
      @click='showNew'
    />

    <q-virtual-scroll
      class='notif-scroll'
      :items='items'
      :virtual-scroll-item-size='200'
      :virtual-scroll-slice-size='10'
      @virtual-scroll='onVirtualScroll'
      v-slot='{ item }'
    >
      <div :key='item'>
        <BasePost
          :event='getEvent(item)'
          :highlighted='lastRead < (getEvent(item) && getEvent(item).created_at)'
          position='standalone'
          @click.stop='toEvent(item)'
        />
        <div class='bottom-border'></div>
      </div>
    </q-virtual-scroll>

    <div v-if='loading' class='row justify-center q-py-md'>
      <q-spinner-orbit color='accent' size='md' />
    </div>
    <div v-else-if='reachedEnd && items.length' class='text-center text-caption text-grey q-py-md'>
      — end of notifications —
    </div>
  </q-page>
</template>

<script>
import { defineComponent, markRaw } from 'vue'
import helpersMixin from '../utils/mixin'
import { createFeed } from '../nostr/feedEngine'
import { useUserStore } from '../stores/user'
import { useProfileStore } from '../stores/profile'
import { useRelayStore } from '../stores/relay'
import { createMetaMixin } from 'quasar'
import BasePost from 'components/BasePost.vue'
import BaseButtonLoadMore from 'components/BaseButtonLoadMore.vue'

const metaData = {
  title: 'lunar - notifications',
  meta: {
    description: { name: 'description', content: 'Nostr notifications on lunar' },
    keywords: { name: 'keywords', content: 'nostr decentralized social media' },
    equiv: { 'http-equiv': 'Content-Type', content: 'text/html; charset=UTF-8' },
  },
}

export default defineComponent({
  name: 'Notifications',
  mixins: [helpersMixin, createMetaMixin(metaData)],
  components: { BasePost, BaseButtonLoadMore },

  data() {
    return { tick: 0 }
  },

  computed: {
    items() {
      void this.tick
      return this.engine ? this.engine.timeline.value : []
    },
    pendingCount() {
      void this.tick
      return this.engine ? this.engine.pending.value.length : 0
    },
    loading() {
      void this.tick
      return this.engine ? this.engine.loading.value : false
    },
    reachedEnd() {
      void this.tick
      return this.engine ? this.engine.reachedEnd.value : false
    },
    lastRead() {
      return this.$store.state.lastNotificationRead
    }
  },

  mounted() {
    this.build()
    this._onVisibility = () => {
      if (!this.engine) return
      if (document.hidden) this.engine.stop()
      else this.engine.resume()
    }
    document.addEventListener('visibilitychange', this._onVisibility)
  },

  activated() {
    this.$store.commit('haveReadNotifications')
  },

  deactivated() {
    this.$store.commit('haveReadNotifications')
  },

  beforeUnmount() {
    if (this._onVisibility) document.removeEventListener('visibilitychange', this._onVisibility)
    if (this.engine) this.engine.destroy()
  },

  methods: {
    build() {
      if (this.engine) this.engine.destroy()

      const userStore = useUserStore()
      const pub = userStore.pub || this.$store.state.keys.pub
      if (!pub) return

      const relays = useRelayStore().urls

      this.engine = markRaw(createFeed({
        baseFilter: { kinds: [1, 6, 7, 9735], '#p': [pub] },
        relays,
        pageSize: 40,
        enrich: (e) => this.interpolateEventMentions(e),
      }))

      this._bumps = [
        this.engine.timeline, this.engine.pending, this.engine.loading, this.engine.reachedEnd
      ]
      this.$watch(
        () => this._bumps.map((r) => r.value),
        () => { this.tick++ },
        { deep: false }
      )

      this.engine.start().then(() => this.ensureProfiles(0, 15))
    },

    getEvent(id) {
      return this.engine ? this.engine.getEvent(id) : null
    },

    ensureProfiles(from, to) {
      if (!this.engine) return
      const profileStore = useProfileStore()
      const ids = this.engine.timeline.value
      for (let i = Math.max(0, from); i <= Math.min(ids.length - 1, to); i++) {
        const e = this.engine.getEvent(ids[i])
        if (e) profileStore.ensure(e.pubkey)
      }
    },

    onVirtualScroll({ from, to }) {
      this.ensureProfiles(from, to + 2)
      if (this.engine && to >= this.items.length - 6) this.engine.loadMore()
    },

    showNew() {
      if (this.engine) this.engine.showNew()
    }
  }
})
</script>

<style lang='scss'>
.notif-scroll {
  height: calc(100svh - 7rem);
  overflow-y: auto;
  overflow-anchor: none;
  padding-bottom: 4rem;
}
</style>
