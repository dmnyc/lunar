<template>
  <q-page>
    <BaseHeader :separator='false'>
      <div class='flex row justify-start items-center' style='gap: 1rem;'>
        <div>{{ $t('feed') }}</div>
        <q-select borderless v-model="feedName" :options="['follows', 'global']" />
      </div>
    </BaseHeader>

    <BaseButtonLoadMore
      v-if='pendingCount'
      :loading-more='false'
      :label='"load " + pendingCount + " new"'
      @click='showNew'
    />

    <q-virtual-scroll
      ref='vscroll'
      class='feed-scroll'
      :items='items'
      :virtual-scroll-item-size='250'
      :virtual-scroll-slice-size='8'
      :virtual-scroll-slice-ratio-before='2'
      :virtual-scroll-slice-ratio-after='2'
      @virtual-scroll='onVirtualScroll'
      v-slot='{ item, index }'
    >
      <div :key='item' class='feed-item'>
        <BasePost
          :event='getEvent(item)'
          position='standalone'
          @click.stop='toEvent(item)'
        />
      </div>
    </q-virtual-scroll>

    <div v-if='loading' class='row justify-center q-py-md'>
      <q-spinner-orbit color='accent' size='md' />
    </div>
    <div v-else-if='reachedEnd && items.length' class='text-center text-caption text-grey q-py-md'>
      — end of feed —
    </div>
  </q-page>
</template>

<script>
import { defineComponent, markRaw } from 'vue'
import helpersMixin from '../utils/mixin'
import { isValidEvent } from '../utils/event'
import { createFeed } from '../nostr/feedEngine'
import BasePost from 'components/BasePost.vue'
import BaseButtonLoadMore from 'components/BaseButtonLoadMore.vue'
import { createMetaMixin } from 'quasar'

const metaData = {
  title: 'lunar',
  meta: {
    description: { name: 'description', content: 'decentralized social media feed built on Nostr' },
    keywords: { name: 'keywords', content: 'nostr decentralized social media' },
    equiv: { 'http-equiv': 'Content-Type', content: 'text/html; charset=UTF-8' },
  },
}

export default defineComponent({
  name: 'Feed',
  mixins: [helpersMixin, createMetaMixin(metaData)],

  components: {
    BasePost,
    BaseButtonLoadMore,
  },

  data() {
    return {
      feedName: 'follows',
      // The engine is held as a non-reactive instance property (assigned in
      // build(), never declared in data) so Vue doesn't wrap its internals; its
      // shallowRefs are still tracked by the computed accessors below.
      tick: 0, // bumped to re-evaluate the ref-backed computeds
    }
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
  },

  watch: {
    feedName(curr, prev) {
      if (curr !== prev) this.build()
    },
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

  beforeUnmount() {
    if (this._onVisibility) document.removeEventListener('visibilitychange', this._onVisibility)
    if (this.engine) this.engine.destroy()
  },

  methods: {
    relays() {
      const r = Object.keys(this.$store.state.relays)
      return r.length ? r : Object.keys(this.$store.state.defaultRelays)
    },

    build() {
      if (this.engine) this.engine.destroy()
      const follows = this.$store.state.follows
      const useFollows = this.feedName === 'follows' && follows.length
      if (this.feedName === 'follows' && !follows.length) this.feedName = 'global'

      // markRaw keeps the engine object (and its closures/Map) out of Vue's
      // reactivity; we drive re-renders manually via tick + the ref computeds.
      this.engine = markRaw(createFeed({
        kinds: [1, 2],
        authors: useFollows ? follows : null,
        relays: this.relays(),
        pageSize: 50,
        enrich: (e) => this.interpolateEventMentions(e),
        valid: isValidEvent,
      }))

      // Vue's reactivity already tracks the shallowRefs inside the computeds, but
      // a markRaw'd container can mask that on some paths — a cheap watcher on the
      // refs bumps `tick` so the template always reflects engine state.
      this._bumps = [
        this.engine.timeline, this.engine.pending, this.engine.loading, this.engine.reachedEnd
      ]
      this.$watch(() => this._bumps.map((r) => r.value), () => { this.tick++ }, { deep: false })

      this.engine.start().then(() => this.ensureProfiles(0, 20))
    },

    getEvent(id) {
      return this.engine ? this.engine.getEvent(id) : null
    },

    // Request profiles for the on-screen author range only (the existing Vuex
    // useProfile action batches in groups of 50 and dedups against the cache).
    ensureProfiles(from, to) {
      if (!this.engine) return
      const ids = this.engine.timeline.value
      for (let i = Math.max(0, from); i <= Math.min(ids.length - 1, to); i++) {
        const e = this.engine.getEvent(ids[i])
        if (e) this.$store.dispatch('useProfile', { pubkey: e.pubkey })
      }
    },

    onVirtualScroll({ from, to }) {
      this.ensureProfiles(from, to + 2)
      if (this.engine && to >= this.items.length - 6) this.engine.loadMore()
    },

    showNew() {
      if (this.engine) this.engine.showNew()
      const vs = this.$refs.vscroll
      if (vs && vs.scrollTo) vs.scrollTo(0)
    },
  },
})
</script>

<style lang='scss'>
.feed-item {
  width: 100%;
}

// Give the virtual scroller its own bounded scroll area so q-virtual-scroll
// reliably virtualizes (only the visible slice is mounted). Without this it
// falls back to the layout's window scroll, can't bound the rendered set, and
// mounts every loaded BasePost — which crashes mobile Safari on a long feed.
.feed-scroll {
  // A bounded-height scroll container is REQUIRED for q-virtual-scroll to
  // virtualize here (window-scroll auto-detection renders every item — verified:
  // 300 items => 300 mounted, 13k DOM nodes). With this, only the visible slice
  // mounts (~15). Uses svh (small viewport height, stable across iOS browser-UI
  // and zoom changes) and omits -webkit-overflow-scrolling:touch, whose momentum
  // layer crashes iOS Safari when pinch-zooming inside a nested scroller.
  height: calc(100svh - 7rem);
  overflow-y: auto;
  overflow-anchor: none;
  padding-bottom: 4rem;
}
</style>
