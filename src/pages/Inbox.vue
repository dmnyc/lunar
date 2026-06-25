<template>
  <q-page>
    <BaseHeader>
      <div class='flex row no-wrap justify-start' style='gap: 1rem;'>
        <span>{{ $t('inbox') }}</span>
        <q-btn
          v-if='$store.getters.unreadChats'
          label='mark all as read'
          @click.stop='markAllAsRead'
          color='secondary'
          outline
          dense
        />
      </div>
    </BaseHeader>

    <div v-if='loading' class='flex row justify-center items-start q-my-md'>
      <q-spinner-orbit color='accent' size='md' />
    </div>

    <q-virtual-scroll
      v-else
      class='inbox-scroll'
      :items='chats'
      :virtual-scroll-item-size='72'
      :virtual-scroll-slice-size='15'
      @virtual-scroll='onScroll'
      v-slot='{ item: chat }'
    >
      <q-item
        :key='chat.peer'
        v-ripple
        clickable
        class='flex row no-padding no-margin justify-between items-center q-gutter-xs'
        @click.capture.stop="$router.push({ name: 'messages', params: { pubkey: hexToBech32(chat.peer, 'npub') } })"
      >
        <div class='col q-pl-md q-pr-auto flex row'>
          <BaseUserCard
            v-if='chat.peer'
            :pubkey='chat.peer'
            :action-buttons='false'
            class='col'
            :clickable='false'
            :show-following='true'
          />
          <q-badge
            v-if='$store.state.unreadMessages[chat.peer]'
            color='secondary'
            outline
            class='text-bold q-my-auto'
          >
            {{ $store.state.unreadMessages[chat.peer] }}
          </q-badge>
        </div>
        <label class='no-padding text-right q-pr-sm'>
          {{ niceDateUTC(chat.lastMessage) }}
        </label>
      </q-item>
    </q-virtual-scroll>

    <div v-if='!loading && !chats.length' class='m-8 text-base q-pa-md'>
      <p>
        Start a chat by clicking the
        <q-icon unelevated color='primary' name='mail_lock' size='md' />
        icon on someone's profile page or user card.
      </p>
    </div>
  </q-page>
</template>

<script>
import { defineComponent } from 'vue'
import { dbChats, streamMainIncomingMessages, streamMainOutgoingMessages } from '../query'
import helpersMixin from '../utils/mixin'
import { useProfileStore } from '../stores/profile'
import { useRelayStore } from '../stores/relay'
import { createMetaMixin } from 'quasar'

const metaData = {
  title: 'lunar - inbox',
  meta: {
    description: { name: 'description', content: 'Nostr direct message inbox' },
    keywords: { name: 'keywords', content: 'nostr decentralized social media' },
    equiv: { 'http-equiv': 'Content-Type', content: 'text/html; charset=UTF-8' },
  },
}

export default defineComponent({
  name: 'Inbox',
  mixins: [helpersMixin, createMetaMixin(metaData)],

  data() {
    return {
      chats: [],
      loading: true,
      sub: {},
    }
  },

  computed: {
    allChatsNeverRead() {
      return Object.keys(this.$store.state.lastMessageRead).length === 0
    }
  },

  async mounted() {
    await this.start()
  },

  beforeUnmount() {
    this.stop()
  },

  methods: {
    async start() {
      this.loading = true
      const relays = useRelayStore().urls

      await this.getChats()

      const pub = this.$store.state.keys.pub
      this.sub.in = streamMainIncomingMessages(
        { authors: [pub], relays, limit: 500 },
        null,
        () => { this.getChats(); this.loading = false }
      )
      this.sub.out = streamMainOutgoingMessages(
        { authors: [pub], relays, limit: 500 },
        null,
        () => { this.getChats(); this.loading = false }
      )
      this.loading = false
    },

    stop() {
      if (this.sub.in) this.sub.in.cancel()
      if (this.sub.out) this.sub.out.cancel()
    },

    async getChats() {
      const pub = this.$store.state.keys.pub
      this.chats = await dbChats(pub)
      const profileStore = useProfileStore()
      this.chats.forEach(({ peer }) => profileStore.ensure(peer))
      if (this.allChatsNeverRead) {
        this.chats.forEach(({ peer }) => this.$store.commit('haveReadMessage', peer))
      }
    },

    markAllAsRead() {
      this.chats.forEach(({ peer }) => this.$store.commit('haveReadMessage', peer))
    },

    onScroll({ from, to }) {
      const profileStore = useProfileStore()
      const slice = this.chats.slice(from, to + 1)
      profileStore.ensureMany(slice.map(c => c.peer))
    }
  }
})
</script>

<style lang='scss' scoped>
.inbox-scroll {
  height: calc(100svh - 7rem);
  overflow-y: auto;
  overflow-anchor: none;
}
</style>
