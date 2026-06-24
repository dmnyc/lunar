<template>
  <q-page>
    <div id='profile-header'>
      <BaseUserCard
        v-if='hexPubkey'
        :pubkey='hexPubkey'
        class='user-card-header q-ma-sm'
        :header-mode='true'
        :show-following='true'
        :clickable='false'
      />
    </div>
    <q-tabs
      v-model="tab"
      dense
      outline
      align="left"
      active-color='accent'
      :breakpoint="0"
    >
      <q-tab name="posts" label='posts' />
      <q-tab name="follows" label='follows' />
      <q-tab name="followers" label='followers' />
      <q-tab name="relays" label='relays' />
    </q-tabs>
    <q-tab-panels v-model="tab" animated>
      <q-tab-panel name="posts" class='no-padding'>
        <q-form
          v-if='threads.length'
          class='q-pa-sm'
          @submit="search"
        >
          <q-input
            v-model="searchText"
            outlined
            rounded
            :label='$t("searchPosts")'
            dense
            color='secondary'
            class='no-padding'
            :loading='searching'
            @submit="search"
            @keypress.ctrl.enter="search"
          >
            <template #append>
              <BaseButtonClear :button-text='searchText' button-class='text-secondary' @clear='searchText=""'/>
              <q-btn
                text-color='secondary'
                class='q-pa-xs'
                icon="search"
                type="submit"
                unelevated
                :disable='searching'
                @click='search'
              />
            </template>
          </q-input>
        </q-form>
        <div v-if='searchResults.length'>
          <BasePostThread v-for="result in searchResults" :key="result[0].id" :events="result" @add-event='addEvent'/>
        </div>
        <div v-if='!searchText'>
          <BasePostThread v-for="thread in threads" :key="thread[0].id" :events="thread" @add-event='addEvent'/>
          <BaseButtonLoadMore :loading-more='loadingMore' :reached-end='reachedEnd' @click='loadMore' />
        </div>
      </q-tab-panel>

      <q-tab-panel name="follows" class='no-padding'>
        <div v-if="!follows.length">{{ $t('noFollows') }}</div>
        <q-virtual-scroll
          v-else
          class='user-list-scroll q-pl-sm'
          :items='follows'
          :virtual-scroll-item-size='72'
          :virtual-scroll-slice-size='12'
          @virtual-scroll='onFollowsScroll'
          v-slot='{ item: pubkey }'
        >
          <BaseUserCard :key='pubkey' :pubkey='pubkey' :show-following='true' />
        </q-virtual-scroll>
      </q-tab-panel>

      <q-tab-panel name="followers" class='no-padding'>
        <div v-if="!followerKeys.length">{{ $t('noFollowers') }}</div>
        <q-virtual-scroll
          v-else
          class='user-list-scroll q-pl-sm'
          :items='followerKeys'
          :virtual-scroll-item-size='72'
          :virtual-scroll-slice-size='12'
          @virtual-scroll='onFollowersScroll'
          v-slot='{ item: pubkey }'
        >
          <BaseUserCard :key='pubkey' :pubkey='pubkey' :show-following='true' />
        </q-virtual-scroll>
      </q-tab-panel>

      <q-tab-panel name="relays" class='no-padding'>
        <div v-if="!relays">{{ $t('noRelays') }}</div>
        <div v-else class="flex column relative">
          <div class='q-pl-sm'>
            <BaseRelayRecommend
              v-for="(relay) in Object.keys(relays)"
              :key="relay"
              :url="relay"
              :list-view='true'
            />
          </div>
        </div>
      </q-tab-panel>
    </q-tab-panels>
  </q-page>
</template>

<script>
import { defineComponent } from 'vue'
import {debounce} from 'quasar'
import helpersMixin from '../utils/mixin'
import {addToThread} from '../utils/threads'
import BaseUserCard from 'components/BaseUserCard.vue'
import { dbProfile, streamProfile, dbStreamFollows, dbStreamFollowers, getNotes, dbQuery } from '../query'
import BaseRelayRecommend from 'components/BaseRelayRecommend.vue'
import BaseButtonLoadMore from 'components/BaseButtonLoadMore.vue'
import BaseButtonClear from 'components/BaseButtonClear.vue'
import { createMetaMixin } from 'quasar'

const metaData = {
  // sets document title
  title: 'lunar - profile',

  // meta tags
  meta: {
    description: { name: 'description', content: 'Nostr user profile' },
    keywords: { name: 'keywords', content: 'nostr decentralized social media' },
    equiv: { 'http-equiv': 'Content-Type', content: 'text/html; charset=UTF-8' },
  },
}

export default defineComponent({
  name: 'Profile',
  mixins: [helpersMixin, createMetaMixin(metaData)],

  components: {
    BaseUserCard,
    BaseRelayRecommend,
    BaseButtonLoadMore,
    BaseButtonClear,
  },

  data() {
    return {
      threads: [],
      eventsSet: new Set(),
      sub: {},
      tab: 'posts',
      followsEvent: null,
      follows: [],
      followers: {},
      followerCount: 0,
      followersSeeded: false,
      // Render follows/followers a page at a time. Rendering the full list at
      // once (and fetching every profile) freezes mobile clients for accounts
      // that follow thousands of users, so we paginate with a "load more" button.
      pageSize: 30,
      followsShown: 30,
      followersShown: 30,
      relays: {},
      profilesUsed: new Set(),
      loadingMore: true,
      reachedEnd: false,
      searchText: '',
      searching: false,
      results: [],
      interval: null,
    }
  },

  computed: {
    searchResults() {
      if (this.searchText.length) return this.results
      return []
    },
    hexPubkey() {
      if (this.$route.params.pubkey) return this.bech32ToHex(this.$route.params.pubkey)
      return ''
    },
    visibleFollows() {
      return this.follows.slice(0, this.followsShown)
    },
    followerKeys() {
      return Object.keys(this.followers)
    },
    visibleFollowers() {
      return this.followerKeys.slice(0, this.followersShown)
    },
  },

  watch: {
    // The lists are virtualized, so fetch profiles only for the rendered slice
    // (the @virtual-scroll handlers extend this as the user scrolls). `follows`
    // is reassigned only a handful of times (one kind-3 per revision), so seeding
    // the first screenful here is cheap. We deliberately do NOT watch
    // `followerKeys` — it recomputes on every streamed follower (thousands), and
    // watching it produced a recompute storm that crashed mobile. Followers are
    // seeded once from the stream callback instead.
    follows() {
      this.fetchUserRange(this.follows, 0, 15)
    },
  },

  mounted() {
    if (this.hexPubkey.length) this.start()
    else {
      this.interval = setInterval(() => {
        if (!this.hexPubkey.length) return
        this.start()
        clearInterval(this.interval)
      }, 500)
    }
  },

  beforeUnmount() {
    this.stop()
  },

  methods: {
    async start() {
      // this.useProfile(this.hexPubkey)
      this.loadingMore = true
      this.followsShown = this.pageSize
      this.followersShown = this.pageSize
      this.followers = {}
      this.followerCount = 0
      this.followersSeeded = false
      let relays = Object.keys(this.$store.state.relays).length ? Object.keys(this.$store.state.relays) : Object.keys(this.$store.state.defaultRelays)

      let profile = await dbProfile(this.hexPubkey)
      if (profile) this.$store.dispatch('handleAddingProfileEventToCache', profile)
      this.sub.streamProfile = await streamProfile({authors: [this.hexPubkey], relays}, async events => {
        for (let event of events) this.$store.dispatch('handleAddingProfileEventToCache', event)
      })
      this.loadMore()

      // let timer = setTimeout(async() => {
      //     this.loadMore()
      //   }, 4000)
      // this.sub.streamUserNotes = await streamUserNotes(this.hexPubkey, event => {
      //   if (!timer) this.processUserNotes([event], this.threads)
      //   if (timer) clearTimeout(timer)
      //   timer = setTimeout(async() => {
      //     this.loadMore()
      //     clearTimeout(timer)
      //     timer = null
      //   }, 500)
      // })
      this.sub.dbStreamFollows = await dbStreamFollows({author: this.hexPubkey, relays}, events => {
        for (let event of events) {
          if (this.followsEvent && event.created_at < this.followsEvent.created_at) continue
          this.followsEvent = event
          this.follows = event.tags
            .filter(([t, v]) => t === 'p' && v)
            .map(([_, v]) => v)
          this.relays = event.content.length ? JSON.parse(event.content) : []
          // Profiles for the visible page are fetched by the visibleFollows
          // watcher; we no longer fetch every follow up front.
        }
      })
      this.sub.dbStreamFollowers = await dbStreamFollowers({author: this.hexPubkey, relays, limit: 300}, events => {
        for (let event of events) {
          if (this.followers[event.pubkey]) continue
          if (this.followerCount >= 300) break // bound memory; followers are approximate
          this.followers[event.pubkey] = true
          this.followerCount++
        }
        // Seed profiles for the first screenful once (the rest load on scroll via
        // onFollowersScroll). We don't watch followerKeys — that recompute storm
        // crashed mobile.
        if (!this.followersSeeded && this.followerCount) {
          this.followersSeeded = true
          this.fetchUserRange(Object.keys(this.followers), 0, 15)
        }
      })
    },

    stop() {
      if (this.sub.streamProfile) this.sub.streamProfile.cancel()
      if (this.sub.streamUserNotes) this.sub.streamUserNotes.cancel()
      if (this.sub.dbStreamFollows) this.sub.dbStreamFollows.cancel()
      if (this.sub.dbStreamFollowers) this.sub.dbStreamFollowers.cancel()
      // this.profilesUsed.forEach(pubkey => this.$store.dispatch('cancelUseProfile', {pubkey}))
      if (this.interval) clearInterval(this.interval)
    },

    processUserNotes(events, threads, checkDups = true) {
      for (let event of events) {
        if (this.eventsSet.has(event.id) && checkDups) continue

        this.interpolateEventMentions(event)
        if (checkDups) this.eventsSet.add(event.id)
        addToThread(threads, event)
      }
    },

    // Fetch profiles for a slice of a pubkey list (used by the virtualized
    // follows/followers lists — only the visible range, not the whole list).
    fetchUserRange(list, from, to) {
      for (let i = Math.max(0, from); i <= Math.min(list.length - 1, to); i++) {
        this.useProfile(list[i])
      }
    },

    onFollowsScroll({ from, to }) {
      this.fetchUserRange(this.follows, from, to + 4)
    },

    onFollowersScroll({ from, to }) {
      this.fetchUserRange(this.followerKeys, from, to + 4)
    },

    useProfile(pubkey) {
      if (this.profilesUsed.has(pubkey)) return

      this.profilesUsed.add(pubkey)
      this.$store.dispatch('useProfile', {pubkey})
    },

    addEvent(event) {
      this.processUserNotes([event], this.threads)
    },

    async loadMore() {
      this.loadingMore = true
      let relays = Object.keys(this.$store.state.relays).length ? Object.keys(this.$store.state.relays) : Object.keys(this.$store.state.defaultRelays)
      let until = this.threads.length ? this.threads[this.threads.length - 1][0].created_at : Math.round(Date.now() / 1000)
      let notes = await getNotes({authors: [this.hexPubkey], until, limit: 100, relays})
      if (notes.length === 0) this.reachedEnd = true
      let threads = []
      this.processUserNotes(notes, threads)
      this.threads = this.threads.concat(threads)
      this.loadingMore = false
    },

    async search() {
      // let query = `%${this.searchText.replace(' ', '%')}%`
      this.searching = true
      this.results = []
      let result = await dbQuery(`
        SELECT event
        FROM nostr
        WHERE json_extract(event,'$.kind') = 1 AND
          json_extract(event,'$.pubkey') = '${this.hexPubkey}' AND
          json_extract(event,'$.content') LIKE '%${this.searchText.replace(' ', '%')}%'
      `)
      let searchResults = result.map(row => JSON.parse(row.event))
      this.processUserNotes(searchResults, this.results, false)
      this.searching = false
    },


    debouncedSearch() {
      debounce(this.search(), 1000)
      console.log('debounced search')
    }
  }
})
</script>

<style lang='css' scoped>
.q-tabs {
  border-bottom: 1px solid var(--q-accent);
}
.q-tab-panels {
  background: var(--q-background);
}
/* Bounded scroll container so q-virtual-scroll virtualizes the follows/followers
   lists (only the visible slice mounts). Without a height it renders every card,
   which OOM-crashes mobile Safari — the same failure the feed had. svh + no
   momentum layer keeps pinch-zoom stable. */
.user-list-scroll {
  height: calc(100svh - 12rem);
  overflow-y: auto;
  overflow-anchor: none;
}
</style>
