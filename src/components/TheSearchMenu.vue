<template>
  <div class='fit flex column no-wrap'>
    <q-card-section class='q-pa-sm'>
      <q-form
        @submit="searchProfile"
      >
        <q-input
          v-model="searchingProfile"
          class='no-padding searchingProfile'
          outlined
          :label='$t("searchProfiles")'
          dense
          color='secondary'
          :hint='validSearch ? "enter user public key or NIP05 identifier" : "INVALID FORMAT! enter user public key or NIP05 identifier"'
          hide-hint
          hide-bottom-space
          :input-style='!validSearch ? "color: #ff0000" : ""'
          :loading='searching'
          @clear.stop='searchingProfile=""'
          @submit="searchProfile"
          @keypress.ctrl.enter="searchProfile"
        >
          <template #append>
            <BaseButtonClear :button-text='searchingProfile' button-class='text-secondary' @clear='searchingProfile=""'/>
            <q-btn
              text-color='secondary'
              class='q-pa-xs'
              icon="search"
              type="submit"
              unelevated
              :disable='!validSearch || searching'
              @click="searchProfile"
            />
          </template>
        </q-input>
      </q-form>
    <div v-if='searchResults.length' class='q-mt-sm'>
      <div class='flex row justify-between no-wrap items-center'>
        <h2 class='text-subtitle1 text-bold q-my-none'>results</h2>
        <q-btn flat dense round icon='close' size='sm' @click.stop='clearResults'/>
      </div>
      <q-list class='q-pt-xs q-pl-sm' style='overflow-y: auto; max-height: 50vh;'>
        <BaseUserCard v-for='pubkey in searchResults' :key='pubkey + "_result"' :pubkey='pubkey'/>
      </q-list>
      <q-separator color='accent'/>
    </div>
    <div v-if='domainMode'>
      <div class='flex row justify-between no-wrap'>
        <h2 class='text-h6 text-bold q-my-none'> {{ domain }} {{ $t('users') }}</h2>
        <q-btn icon='close' @click.stop='domainMode = false' />
      </div>
      <div v-if='domainDefaultPubkey'>
        <h2 class='text-caption text-bold q-my-none'> {{ $t('nip05Maintainer') }} </h2>
        <BaseUserCard :pubkey='domainDefaultPubkey'/>
      </div>
        <q-list class='q-pt-xs q-pl-sm' style='overflow-y: auto; max-height: 40vh;'>
          <div v-for="user in domainUsers" :key="user.pubkey">
            <BaseUserCard :pubkey="user.pubkey" />
          </div>
        </q-list>
        <q-separator color='accent' />
    </div>
    </q-card-section>
      <div v-if='$store.state.keys.pub' class='flex row justify-between no-wrap'>
        <h2 class='text-h5 text-bold q-my-none'> {{ $t('follows') }} </h2>
        <div>
          <q-btn v-if='!reordering' flat icon='reorder' @click.stop='reorderFollows'>
            <q-tooltip>{{ $t('reorderFollows') }}</q-tooltip>
          </q-btn>
          <q-btn v-if='reordering' flat icon='close' @click.stop='cancelReorder'>
            <q-tooltip>{{ $t('cancel') }}</q-tooltip>
          </q-btn>
        </div>
      </div>
    <q-card-section v-if='$store.state.keys.pub' class='no-padding' style='overflow-y: auto;'>
      <div v-if='$store.state.follows.length' class='q-mt-xs q-pl-sm'>
        <q-virtual-scroll
          v-if="!reordering"
          style="height: calc(100svh - 16rem); overflow-y: auto;"
          :items="$store.state.follows"
          :virtual-scroll-item-size="72"
          :virtual-scroll-slice-size="12"
          @virtual-scroll="onSearchFollowsScroll"
          v-slot="{ item: pubkey }"
        >
          <BaseUserCard :pubkey="pubkey" :key="pubkey" />
        </q-virtual-scroll>
        <Draggable
          v-else-if='reorderedFollows.length'
          v-model='reorderedFollows'
          @start="dragging=true"
          @end="dragging=false"
          :item-key="pubkey + '_reordering'"
        >
          <template #header>
            <div class='flex row justify-between items-start'>
              <span>{{ $t('dragDropReorder') }}</span>
              <q-btn outline size='sm' icon='save' :label='$t("save")' color='secondary' @click.stop='saveReorder'/>
            </div>
          </template>
          <template #item="{element}">
            <BaseUserCard :pubkey='element.pubkey' :action-buttons='false'/>
          </template>
        </Draggable>
      </div>
      <div v-else>
        {{ $t('noFollows') }}
      </div>
    </q-card-section>
  </div>
</template>

<script>
import { defineComponent } from 'vue'
import {Notify, debounce} from 'quasar'
import Draggable from 'vuedraggable'
import {nip05} from 'nostr-tools'
import helpersMixin from '../utils/mixin'
import BaseButtonClear from 'components/BaseButtonClear.vue'
import { searchProfiles } from '../nostr/profileSearch'

export default defineComponent({
  name: 'TheSearchMenu',
  mixins: [helpersMixin],

  data() {
    return {
      searchingProfile: '',
      searching: false,
      domainMode: false,
      domainNames: {},
      reordering: false,
      reorderedFollows: [],
      dragging: false,
      profilesUsed: new Set(),
      searchResults: [],
    }
  },

  created() {
    // debounce name search-as-you-type
    this.debouncedNameSearch = debounce((q) => this.runNameSearch(q), 400)
  },

  components: {
    BaseButtonClear,
    Draggable,
  },

  computed: {
    validSearch() {
      if (this.searchingProfile === '') return true
      if (this.searchingProfile.match(/^[a-f0-9A-F]{64}$/)) return true
      if (this.isBech32Key(this.searchingProfile) && this.bech32ToHex(this.searchingProfile).match(/^[a-f0-9A-F]{64}$/)) return true
      if (this.searchingProfile.match(/^([a-z0-9A-Z-_.\u00C0-\u1FFF\u2800-\uFFFD]*@)?[a-z0-9A-Z-_]+[.]{1}[a-z0-9A-Z-_.]+$/)) return true
      // plain name search is valid too (2+ chars)
      if (this.searchingProfile.trim().length >= 2) return true
      return false
    },
    domainDefaultPubkey() {
      return this.domainNames._
    },
    domainUsers() {
      let users = Object.keys(this.domainNames).filter((name) => name !== '_').map((name) => { return { 'name': name, 'pubkey': this.domainNames[name] } })
      return users
    },
    domain() {
      let [name, domain] = this.searchingProfile.split('@')
      return domain || name
    }
  },

  watch: {
    searchingProfile(val) {
      const q = (val || '').trim()
      if (q.length < 2) {
        this.clearResults()
        return
      }
      // skip name search for identifiers (handled by submit): hex, bech32, nip05/domain
      if (q.match(/^[a-f0-9]{64}$/i)) return
      if (/^(npub|nsec|note|nevent|nprofile)1/.test(q)) return
      if (q.includes('@') || /\.[a-z]{2,}$/i.test(q)) return
      this.debouncedNameSearch(q)
    },
  },

  // deactivated() {
  //   this.profilesUsed.forEach(pubkey => this.$store.dispatch('cancelUseProfile', {pubkey}))
  // },

  methods: {

    async runNameSearch(query) {
      this.searching = true
      try {
        const profiles = await searchProfiles(query, 10)
        // seed the cache so BaseUserCard renders names + avatars instantly
        for (const p of profiles) this.$store.commit('addProfileToCache', p)
        this.searchResults = profiles.map((p) => p.pubkey)
      } catch (e) {
        console.warn('[search] name search failed', e)
      } finally {
        this.searching = false
      }
    },

    clearResults() {
      this.searchResults = []
    },

    async searchProfile() {
      if (!this.validSearch) {
        Notify.create({
          message: 'Invalid format! Please enter full public key or NIP05 identifier',
          color: 'negative'
        })
        return
      }

      this.searching = true
      this.searchingProfile = this.searchingProfile.trim()

      if (this.searchingProfile.match(/^[a-fA-F0-9]{64}$/)) {
        this.toProfile(this.searchingProfile.toLowerCase())
        this.searchingProfile = ''
        this.searching = false
        return
      }

      // npub/nprofile → profile, note/nevent → event (bech32ToHex normalizes
      // nevent/nprofile objects to their hex id/pubkey)
      const q = this.searchingProfile.trim()
      const hex = this.bech32ToHex(q)
      if (hex && /^[a-f0-9]{64}$/i.test(hex)) {
        if (q.startsWith('npub') || q.startsWith('nprofile')) this.toProfile(hex)
        else if (q.startsWith('note') || q.startsWith('nevent')) this.toEvent(hex)
        this.searchingProfile = ''
        this.searching = false
        return
      }

      if (this.searchingProfile.match(/^([a-zA-Z0-9-_.\u00C0-\u1FFF\u2800-\uFFFD]*@)?[a-zA-Z0-9-_.]+[.]{1}[a-zA-Z0-9-_.]+$/)) {
          if (this.searchingProfile.match(/^@/) || !this.searchingProfile.match(/@/)) {
            this.domainNames = await nip05.searchDomain(this.domain)
            if (this.domainUsers.length || this.domainDefaultPubkey) {
              if (this.domainDefaultPubkey) this.useProfile(this.domainDefaultPubkey)
              if (this.domainUsers.length) this.domainUsers.forEach((user) => this.useProfile(user.pubkey))
              this.searching = false
              this.domainMode = true
              return
            }
          } else {
            let {pubkey} = await nip05.queryProfile(this.searchingProfile)
            if (pubkey) {
              this.toProfile(pubkey)
              this.searchingProfile = ''
              this.searching = false
              return
            }
          }
      }
      // plain text → name search
      await this.runNameSearch(this.searchingProfile)
      if (!this.searchResults.length) {
        Notify.create({
          message: 'No users found for that search',
          color: 'negative'
        })
      }
    },

    reorderFollows() {
      this.reorderedFollows = this.$store.state.follows.map((pubkey) => { return {pubkey} })
      this.reordering = true
    },

    saveReorder() {
      this.$store.commit('reorderFollows', this.reorderedFollows.map(follow => follow.pubkey))
      this.reordering = false
      this.reorderedFollows = []
    },

    cancelReorder() {
      this.reordering = false
      this.reorderedFollows = []
    },

    // Fetch profiles only for the on-screen follows (the list is virtualized;
    // rendering all 1000+ avatar cards at once instantly OOM-crashed mobile).
    onSearchFollowsScroll({ from, to }) {
      const follows = this.$store.state.follows
      for (let i = Math.max(0, from); i <= Math.min(follows.length - 1, to + 4); i++) {
        this.useProfile(follows[i])
      }
    },

    useProfile(pubkey) {
      if (this.profilesUsed.has(pubkey)) return

      this.profilesUsed.add(pubkey)
      this.$store.dispatch('useProfile', {pubkey})
    },
  }
})
</script>
