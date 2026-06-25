<template>
  <div class='search-menu fit flex column no-wrap'>

    <!-- ── search input ─────────────────────────────────────── -->
    <div class='q-pa-sm'>
      <q-form @submit='searchProfile'>
        <q-input
          v-model='searchingProfile'
          class='no-padding'
          outlined
          :label='$t("searchProfiles")'
          dense
          color='secondary'
          :hint='validSearch ? "enter user public key or NIP05 identifier" : "INVALID FORMAT!"'
          hide-hint
          hide-bottom-space
          :input-style='!validSearch ? "color: #ff0000" : ""'
          :loading='searching'
          @clear.stop='searchingProfile = ""'
          @keypress.ctrl.enter='searchProfile'
        >
          <template #append>
            <BaseButtonClear :button-text='searchingProfile' button-class='text-secondary' @clear='searchingProfile = ""'/>
            <q-btn
              text-color='secondary'
              class='q-pa-xs'
              icon='search'
              type='submit'
              unelevated
              :disable='!validSearch || searching'
              @click='searchProfile'
            />
          </template>
        </q-input>
      </q-form>

      <!-- search results -->
      <div v-if='searchResults.length' class='q-mt-sm'>
        <div class='flex row justify-between no-wrap items-center'>
          <h2 class='text-subtitle1 text-bold q-my-none'>results</h2>
          <q-btn flat dense round icon='close' size='sm' @click.stop='clearResults'/>
        </div>
        <q-list class='q-pt-xs q-pl-sm' style='overflow-y: auto; max-height: 40vh;'>
          <BaseUserCard v-for='pubkey in searchResults' :key='pubkey + "_result"' :pubkey='pubkey'/>
        </q-list>
        <q-separator color='accent'/>
      </div>

      <!-- domain lookup results -->
      <div v-if='domainMode' class='q-mt-sm'>
        <div class='flex row justify-between no-wrap'>
          <h2 class='text-h6 text-bold q-my-none'>{{ domain }} {{ $t('users') }}</h2>
          <q-btn icon='close' flat round dense size='sm' @click.stop='domainMode = false'/>
        </div>
        <div v-if='domainDefaultPubkey'>
          <h2 class='text-caption text-bold q-my-none'>{{ $t('nip05Maintainer') }}</h2>
          <BaseUserCard :pubkey='domainDefaultPubkey'/>
        </div>
        <q-list class='q-pt-xs q-pl-sm' style='overflow-y: auto; max-height: 35vh;'>
          <BaseUserCard v-for='user in domainUsers' :key='user.pubkey' :pubkey='user.pubkey'/>
        </q-list>
        <q-separator color='accent'/>
      </div>
    </div>

    <!-- ── follows section — grows to fill remaining height ─── -->
    <div v-if='$store.state.keys.pub' class='follows-section flex column no-wrap'>
      <div class='flex row justify-between no-wrap items-center q-px-sm q-pb-xs'>
        <h2 class='text-h5 text-bold q-my-none'>{{ $t('follows') }}</h2>
        <div>
          <q-btn v-if='!reordering' flat icon='reorder' size='sm' @click.stop='reorderFollows'>
            <q-tooltip>{{ $t('reorderFollows') }}</q-tooltip>
          </q-btn>
          <q-btn v-else flat icon='close' size='sm' @click.stop='cancelReorder'>
            <q-tooltip>{{ $t('cancel') }}</q-tooltip>
          </q-btn>
        </div>
      </div>

      <div v-if='$store.state.follows.length' class='follows-list'>
        <!-- Normal view: virtual scroll fills remaining height -->
        <q-virtual-scroll
          v-if='!reordering'
          class='follows-scroll'
          :items='$store.state.follows'
          :virtual-scroll-item-size='72'
          :virtual-scroll-slice-size='12'
          @virtual-scroll='onSearchFollowsScroll'
          v-slot='{ item: pubkey }'
        >
          <BaseUserCard :pubkey='pubkey' :key='pubkey'/>
        </q-virtual-scroll>

        <!-- Reorder mode -->
        <div v-else class='follows-scroll' style='overflow-y: auto;'>
          <div v-if='$store.state.follows.length > REORDER_CAP' class='q-pa-md text-center'>
            <p class='text-caption text-grey q-mb-sm'>
              Drag-to-reorder works up to {{ REORDER_CAP }} follows.<br>
              You follow {{ $store.state.follows.length }} people — too many to reorder here.
            </p>
            <q-btn flat size='sm' color='secondary' label='cancel' @click.stop='cancelReorder'/>
          </div>
          <Draggable
            v-else-if='reorderedFollows.length'
            v-model='reorderedFollows'
            @start='dragging = true'
            @end='dragging = false'
            :item-key='item => item.pubkey'
          >
            <template #header>
              <div class='flex row justify-between items-center q-px-sm q-py-xs'>
                <span class='text-caption text-grey'>{{ $t('dragDropReorder') }}</span>
                <q-btn outline size='sm' icon='save' :label='$t("save")' color='secondary' @click.stop='saveReorder'/>
              </div>
            </template>
            <template #item='{ element }'>
              <BaseUserCard :pubkey='element.pubkey' :action-buttons='false'/>
            </template>
          </Draggable>
        </div>
      </div>

      <div v-else class='q-pa-md text-caption text-grey'>
        {{ $t('noFollows') }}
      </div>
    </div>
  </div>
</template>

<script>
import { defineComponent } from 'vue'
import { Notify, debounce } from 'quasar'
import Draggable from 'vuedraggable'
import { nip05 } from 'nostr-tools'
import helpersMixin from '../utils/mixin'
import BaseButtonClear from 'components/BaseButtonClear.vue'
import { searchProfiles } from '../nostr/profileSearch'

const REORDER_CAP = 300

export default defineComponent({
  name: 'TheSearchMenu',
  mixins: [helpersMixin],
  components: { BaseButtonClear, Draggable },

  data() {
    return {
      REORDER_CAP,
      searchingProfile: '',
      searching: false,
      domainMode: false,
      domainNames: {},
      reordering: false,
      reorderedFollows: [],
      dragging: false,
      profilesLoaded: new Set(),
      searchResults: [],
    }
  },

  created() {
    this.debouncedNameSearch = debounce((q) => this.runNameSearch(q), 400)
  },

  computed: {
    validSearch() {
      if (this.searchingProfile === '') return true
      if (this.searchingProfile.match(/^[a-f0-9A-F]{64}$/)) return true
      if (this.isBech32Key(this.searchingProfile) && this.bech32ToHex(this.searchingProfile).match(/^[a-f0-9A-F]{64}$/)) return true
      if (this.searchingProfile.match(/^([a-z0-9A-Z-_.À-῿⠀-�]*@)?[a-z0-9A-Z-_]+[.]{1}[a-z0-9A-Z-_.]+$/)) return true
      if (this.searchingProfile.trim().length >= 2) return true
      return false
    },
    domainDefaultPubkey() { return this.domainNames._ },
    domainUsers() {
      return Object.keys(this.domainNames)
        .filter((name) => name !== '_')
        .map((name) => ({ name, pubkey: this.domainNames[name] }))
    },
    domain() {
      const [name, domain] = this.searchingProfile.split('@')
      return domain || name
    }
  },

  watch: {
    searchingProfile(val) {
      const q = (val || '').trim()
      if (q.length < 2) { this.clearResults(); return }
      if (q.match(/^[a-f0-9]{64}$/i)) return
      if (/^(npub|nsec|note|nevent|nprofile)1/.test(q)) return
      if (q.includes('@') || /\.[a-z]{2,}$/i.test(q)) return
      this.debouncedNameSearch(q)
    },
  },

  methods: {
    async runNameSearch(query) {
      this.searching = true
      try {
        const profiles = await searchProfiles(query, 10)
        for (const p of profiles) this.$store.commit('addProfileToCache', p)
        this.searchResults = profiles.map((p) => p.pubkey)
      } catch (e) {
        console.warn('[search] name search failed', e)
      } finally {
        this.searching = false
      }
    },

    clearResults() { this.searchResults = [] },

    async searchProfile() {
      if (!this.validSearch) {
        Notify.create({ message: 'Invalid format! Enter a public key or NIP-05 identifier.', color: 'negative' })
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

      const q = this.searchingProfile
      const hex = this.bech32ToHex(q)
      if (hex && /^[a-f0-9]{64}$/i.test(hex)) {
        if (q.startsWith('npub') || q.startsWith('nprofile')) this.toProfile(hex)
        else if (q.startsWith('note') || q.startsWith('nevent')) this.toEvent(hex)
        this.searchingProfile = ''
        this.searching = false
        return
      }

      if (this.searchingProfile.match(/^([a-zA-Z0-9-_.À-῿⠀-�]*@)?[a-zA-Z0-9-_.]+[.]{1}[a-zA-Z0-9-_.]+$/)) {
        if (this.searchingProfile.match(/^@/) || !this.searchingProfile.match(/@/)) {
          this.domainNames = await nip05.searchDomain(this.domain)
          if (this.domainUsers.length || this.domainDefaultPubkey) {
            if (this.domainDefaultPubkey) this.loadProfile(this.domainDefaultPubkey)
            this.domainUsers.forEach((u) => this.loadProfile(u.pubkey))
            this.searching = false
            this.domainMode = true
            return
          }
        } else {
          const { pubkey } = await nip05.queryProfile(this.searchingProfile)
          if (pubkey) {
            this.toProfile(pubkey)
            this.searchingProfile = ''
            this.searching = false
            return
          }
        }
      }

      await this.runNameSearch(this.searchingProfile)
      if (!this.searchResults.length) {
        Notify.create({ message: 'No users found for that search.', color: 'negative' })
      }
      this.searching = false
    },

    reorderFollows() {
      this.reorderedFollows = this.$store.state.follows.map((pubkey) => ({ pubkey }))
      this.reordering = true
    },

    saveReorder() {
      this.$store.commit('reorderFollows', this.reorderedFollows.map((f) => f.pubkey))
      this.reordering = false
      this.reorderedFollows = []
    },

    cancelReorder() {
      this.reordering = false
      this.reorderedFollows = []
    },

    // Load profiles for the visible slice only — feeds the Vuex cache that BaseUserCard reads.
    onSearchFollowsScroll({ from, to }) {
      const follows = this.$store.state.follows
      for (let i = Math.max(0, from); i <= Math.min(follows.length - 1, to + 4); i++) {
        this.loadProfile(follows[i])
      }
    },

    loadProfile(pubkey) {
      if (!pubkey || this.profilesLoaded.has(pubkey)) return
      this.profilesLoaded.add(pubkey)
      this.$store.dispatch('useProfile', { pubkey })
    },
  }
})
</script>

<style lang='scss' scoped>
.search-menu {
  // Flex column; children below the search box fill the rest.
}

.follows-section {
  flex: 1;
  min-height: 0;   // critical: lets flex child shrink below its content height
  overflow: hidden;
}

.follows-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.follows-scroll {
  flex: 1;
  min-height: 0;
  height: 100%;
}
</style>
