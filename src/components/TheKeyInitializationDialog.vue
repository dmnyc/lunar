<template>
  <!-- <q-dialog persistent> -->
  <!-- <div v-if="showKeyInitialization"> -->
    <q-card class='relative-position full-width'>
      <q-btn icon='close' size='md' flat round class='absolute-top-right z-top' @click='$emit("look-around")'/>
      <h1 class="text-h6 q-pr-md">welcome to lunar</h1>
      <q-expansion-item
        dense
        expand-icon='help'
        expanded-icon='expand_less'
        class="intro no-padding full-width items-center"
        header-class='items-center'
      >
        <template #header>
          <span class='full-width'>click here to learn about Nostr, your keys, and how to use lunar</span>
        </template>
        <BaseInformation/>
        <span style='padding: .2rem 0 0 .2rem;'>note: after login this same information can be found in
        the <strong>faq</strong> section at the bottom of the settings page</span>
      </q-expansion-item>

      <div class='q-mt-sm flex column' style='gap: .4rem;'>
        <h2 class="text-subtitle2 q-pr-md">sign in with a signer</h2>
        <div class='flex row no-wrap' style='gap: .4rem;'>
          <q-btn
            v-if='hasExtension'
            size='sm'
            color='primary'
            outline
            class='col'
            icon-right='extension'
            label='browser extension'
            :loading='extensionConnecting'
            @click='loginWithExtension'
          />
          <q-btn
            size='sm'
            color='primary'
            outline
            class='col'
            icon-right='vpn_key'
            label='remote signer'
            @click='showBunker = !showBunker'
          />
        </div>
        <div v-if='showBunker' class='flex column' style='gap: .5rem;'>
          <!-- paste a bunker:// string -->
          <div class='flex row no-wrap items-center' style='gap: .3rem;'>
            <q-input
              v-model='bunkerString'
              dense
              outlined
              class='col'
              label='bunker:// connection string'
            />
            <q-btn
              size='sm'
              color='positive'
              label='connect'
              :loading='bunkerConnecting'
              :disable='!bunkerString'
              @click='loginWithBunker'
            />
          </div>
          <span class='text-secondary' style='font-size: .75rem;'>paste a bunker:// string from Amber, Clave, or Primal</span>

          <!-- or scan a nostrconnect QR with the signer app -->
          <div class='flex row items-center' style='gap: .5rem;'>
            <q-separator class='col' color='accent'/>
            <span class='text-secondary' style='font-size: .75rem;'>or scan with your signer</span>
            <q-separator class='col' color='accent'/>
          </div>

          <div v-if='!nostrconnectUri' class='flex justify-center'>
            <q-btn
              size='sm'
              color='primary'
              outline
              icon-right='qr_code_2'
              label='generate QR code'
              :loading='startingPairing'
              @click='startNostrConnect'
            />
          </div>

          <div v-else class='flex column items-center' style='gap: .4rem;'>
            <div class='bg-white q-pa-sm' style='border-radius: .4rem;'>
              <BaseQr :code='nostrconnectUri'/>
            </div>
            <div class='flex row items-center' style='gap: .3rem;'>
              <q-spinner-dots v-if='pairingStatus' color='accent' size='sm'/>
              <span style='font-size: .8rem;'>{{ pairingStatus }}</span>
            </div>
            <div class='flex row no-wrap' style='gap: .4rem;'>
              <q-btn size='sm' color='primary' outline icon='open_in_new' label='open signer app' @click='openInSignerApp'/>
              <q-btn size='sm' flat icon='content_copy' label='copy' @click='copyNostrconnect'/>
            </div>
            <span class='text-secondary text-center' style='font-size: .72rem; max-width: 22rem;'>
              scan this with Amber, Clave, or another NIP-46 signer, or tap “open signer app” on mobile, then approve the connection.
            </span>
          </div>
        </div>
        <span v-if='signerError' class='text-negative' style='font-size: .8rem;'>{{ signerError }}</span>
      </div>

      <h2 class="text-subtitle2 q-pr-md">or enter a key directly</h2>
      <q-form @submit="proceed">
        <q-card-section class="key-entry no-padding">
          <q-btn-group spread unelevated>
            <q-btn
              size="sm"
              color="primary"
              label="public key"
              :outline="!watchOnly"
              :text-color="!watchOnly ? '' : 'dark'"
              value="true"
              @click="watchOnly = true"
              :disable='isBech32Sec'
            />
            <q-btn
              size="sm"
              color="primary"
              label="private key"
              :outline="watchOnly"
              :text-color="watchOnly ? '' : 'dark'"
              value="false"
              @click="watchOnly = false"
              :disable='isBech32Pub'
            />
          </q-btn-group>
          <q-input
            v-model="key"
            ref="keyInput"
            bottom-slots
            outlined
            :label="watchOnly ? 'enter public key' : 'enter private key'"
            dense
          >
            <template #hint>
              <p v-if="!key && watchOnly">
                entering public key means you will need to enter private key
                each time you post content (either manually or by Nostr browser
                extension)
              </p>
              <p v-if="!key && !watchOnly">
                entering private key means lunar will automatically sign with
                your private key each time you post content
              </p>
              <p v-if="key && !isKeyValid">not a valid key</p>
              <p v-if="isKeyValid">key is valid</p>
            </template>
            <template #append>
              <q-btn
                v-if="!isKeyValid"
                size="sm"
                color="primary"
                outline
                @click="generate"
              >
                generate keys
              </q-btn>
              <q-btn
                v-if="hasExtension && !isKeyValid"
                size="sm"
                color="primary"
                outline
                @click="getFromExtension"
              >
                use public key from extension
              </q-btn>
              <q-btn
                type="submit"
                unelevated
                size="sm"
                color="positive"
                :label="isKeyValid ? 'proceed' : ''"
                icon-right="login"
                style='color: var(--q-background) !important;'
                @click="proceed"
                :disabled="!isKeyValid"
              ></q-btn>
            </template>
          </q-input>
        </q-card-section>
      <!-- <div v-if='isBech32Key(key)'>
      {{ hexKey }}
      </div> -->
      </q-form>
      <q-expansion-item
        v-if='isKeyValid'
        dense
        dense-toggle
        default-opened
        id='bootstrap-relays'
      >
        <template #header>
          <div class='full-width flex row no-wrap items-center'>
            <h2 class="text-subtitle2 q-pr-md">enter bootstrap relays (optional)</h2>
            <q-icon name='info'>
              <q-tooltip>
              the selected relays below will be queried to load your user profile, follows, and relay data from Nostr network.
              please ensure the list of selected relays includes relays you publish your Nostr data to, otherwise lunar may
              not be able to find your data.
              </q-tooltip>
            </q-icon>
          </div>
        </template>
        <div class='flex row justify-between no-wrap items-end' >
          <span>selected relays</span>
          <div class='flex row items-end' id='new-relay-input'>
            <q-input v-model='newRelay' placeholder='add a relay...' input-style='padding: 0; width: 10rem;' @keypress.enter='addNewRelay' dense borderless/>
            <q-btn icon='add' color='positive' size='sm' flat dense @click.stop='addNewRelay'/>
          </div>
        </div>
        <BaseSelectMultiple>
          <template #selected>
            <pre class='relay-list' style='border: 1px solid var(--q-primary);'>
              <li
                v-for='(relay, index) in Object.keys(selectedRelays)'
                :key='index + "-" + relay'
                class='relay-item'
                @click.stop='delete selectedRelays[relay]'
              >
                <div class='flex row justify-between no-wrap'>
                  <span style='overflow: auto;'>{{relay}}</span>
                  <q-icon name='remove' size='xs' color='negative'/>
                </div>
              </li>
            </pre>
          </template>
          <template #options>
            <div style='max-height: 6.75rem;'>
            <pre class='relay-list' >
              <li
                v-for='(relay, index) in optionalRelays'
                :key='index + "-" + relay'
                class='relay-item'
                @click.stop='selectedRelays[relay]={read: true, write:false}'
              >
                <div class='flex row justify-between no-wrap'>
                  <span style='overflow: auto;'>{{relay}}</span>
                  <q-icon name='add' size='xs' color='positive' flat/>
                </div>
              </li>
            </pre>
            </div>
          </template>
        </BaseSelectMultiple>
      </q-expansion-item>
      <div style='min-height: 1rem;'/>
    </q-card>
  <!-- </div> -->
  <!-- </q-dialog> -->
</template>

<script>
import { defineComponent } from 'vue'
import helpersMixin from '../utils/mixin'
import { generatePrivateKey, nip06 } from '../utils/ntcompat'
import { getAuthManager } from '../nostr/authManager'
import { copyToClipboard, Notify } from 'quasar'
// import { decode } from 'bech32-buffer'
import BaseSelectMultiple from 'components/BaseSelectMultiple.vue'
import BaseInformation from 'components/BaseInformation.vue'
import BaseQr from 'components/BaseQr.vue'

export default defineComponent({
  name: 'TheKeyInitializationDialog',
  mixins: [helpersMixin],
  emits: ['look-around'],

  components: {
    BaseSelectMultiple,
    BaseInformation,
    BaseQr,
  },

  setup() {
    return {
      focusKeyInput() {
        this.$refs.keyInput.focus()
      },
    }
  },

  data() {
    return {
      watchOnly: false,
      key: null,
      // detect a NIP-07 extension immediately (most inject window.nostr before
      // mount); the delayed re-check in created() is just a fallback for
      // late-injecting extensions, so the button doesn't pop in after load
      hasExtension: typeof window !== 'undefined' && !!window.nostr,
      selectedRelays: this.$store.state.defaultRelays,
      newRelay: '',
      showBunker: false,
      bunkerString: '',
      bunkerConnecting: false,
      extensionConnecting: false,
      signerError: '',
      nostrconnectUri: '',
      pairingStatus: '',
      startingPairing: false,
      authUnsub: null,
      finishedLogin: false,
    }
  },

  computed: {
    icon() {
      return document.getElementById('icon').href
    },

    // showKeyInitialization() {
    //   if (['profile', 'event', 'hashtag', 'feed'].includes(this.$route.name)) return false
    //   return true
    // },

    isKeyKey() {
      if (this.isKey(this.hexKey)) return true
      return false
    },

    isKeyValid() {
      if (this.isKeyKey) return true
      if (nip06.validateWords(this.key?.toLowerCase())) return true
      return false
    },

    isKeyInvalid() {
      return !this.isKeyValid
    },

    hexKey() {
      // npub1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzsevkk5s
      // nsec1xtscya34g58tk0z605fvr788k263gsu6cy9x0mhnm87echrgufzs46ahj9
      // 32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245
      if (this.isBech32Key(this.key)) {
        return this.bech32ToHex(this.key)
      }
      return this.key?.toLowerCase()
    },

    isBech32Pub() {
      if (this.isBech32Key(this.key)) {
        return this.key.toLowerCase().startsWith('npub')
      }
      return false
    },

    isBech32Sec() {
      if (this.isBech32Key(this.key)) {
        return this.key.toLowerCase().startsWith('nsec')
      }
      return false
    },

    optionalRelays() {
      let options = this.$store.state.optionalRelaysList.filter(relay => {
        if (this.newRelay.length && !relay.toLowerCase().includes(this.newRelay.toLowerCase())) return false
        if (this.selectedRelays[relay]) return false
        return true
      })
      return options
    }
  },

  async created() {
    if (!this.$store.state.keys.pub) {
      // keys not set up, offer the option to try to get a pubkey from window.nostr
      setTimeout(() => {
        if (window.nostr) {
          this.hasExtension = true
        }
      }, 1000)
    }

    // Watch the signer for async logins (NIP-46 nostrconnect approval arrives
    // via a relay listener, not a button click) — finish login when it lands.
    const auth = getAuthManager()
    if (auth) {
      this.authUnsub = auth.subscribe((state) => {
        if (state.isAuthenticated && state.publicKey) this.handleAuthenticated(state.publicKey)
        else if (state.error) this.signerError = state.error
      })
      // Returning from a signer app (e.g. Amber) with a pairing in flight:
      // re-arm the listener and show the QR/waiting state.
      if (auth.hasPendingNip46Pairing && auth.hasPendingNip46Pairing()) {
        this.showBunker = true
        this.pairingStatus = 'waiting for approval…'
        const pending = auth.getPendingNip46Info && auth.getPendingNip46Info()
        if (pending) this.nostrconnectUri = '' // QR already scanned; just show status
        auth.restartNip46ListenerIfPending && auth.restartNip46ListenerIfPending().catch(() => {})
      }
    }
  },

  beforeUnmount() {
    if (this.authUnsub) this.authUnsub()
  },

  methods: {
    async getFromExtension() {
      try {
        this.key = await window.nostr.getPublicKey()
        this.watchOnly = true
        this.focusKeyInput()
      } catch (err) {
        this.$q.notify({
          message: `Failed to get a public key from a Nostr extension: ${err}`,
          color: 'warning',
        })
      }
    },

    generate() {
      this.key = generatePrivateKey()
      this.watchOnly = false
      this.focusKeyInput()
    },

    proceed() {
      let key = this.hexKey

      var keys = {}
      // eslint-disable-next-line no-undef
      // if (validateWords(key)) {
      //   keys.mnemonic = key
      // } else if (this.isKey(key)) {
      if (this.isKey(key)) {
        if (this.watchOnly) keys.pub = key
        else keys.priv = key
      } else {
        console.warn('Proceed called with invalid key', key)
      }

      this.$store.commit('setDefaultRelays', this.selectedRelays)
      this.$store.dispatch('initKeys', keys)
      this.$store.dispatch('launch')
      this.initializeKeys = false
      this.$router.push({
        name: 'settings',
        params: { initUser: true },
      })
    },

    addNewRelay() {
      if (this.newRelay && this.newRelay.length) this.selectedRelays[this.newRelay] = {read: true, write: false}
      this.newRelay = ''
    },

    // Finish a remote-signer login: store the pubkey (no private key — signing
    // is delegated to the active NDK signer), then launch like proceed() does.
    finishRemoteLogin(pub) {
      this.$store.commit('setDefaultRelays', this.selectedRelays)
      this.$store.dispatch('initKeys', { pub })
      this.$store.dispatch('launch')
      this.$router.push({ name: 'settings', params: { initUser: true } })
    },

    // Single funnel for every signer login (extension / bunker / nostrconnect),
    // fired by the auth-state subscription. Guarded so it runs once.
    handleAuthenticated(pub) {
      if (this.finishedLogin || !pub) return
      this.finishedLogin = true
      this.finishRemoteLogin(pub)
    },

    async loginWithExtension() {
      this.signerError = ''
      const auth = getAuthManager()
      if (!auth) {
        this.signerError = 'signer not ready, please reload'
        return
      }
      this.extensionConnecting = true
      try {
        await auth.authenticateWithNIP07() // subscription → handleAuthenticated
      } catch (err) {
        this.signerError = err?.message || 'could not connect to extension'
      } finally {
        this.extensionConnecting = false
      }
    },

    async loginWithBunker() {
      this.signerError = ''
      const auth = getAuthManager()
      if (!auth) {
        this.signerError = 'signer not ready, please reload'
        return
      }
      this.bunkerConnecting = true
      try {
        await auth.authenticateWithNIP46(this.bunkerString.trim())
      } catch (err) {
        this.signerError = err?.message || 'could not connect to remote signer'
      } finally {
        this.bunkerConnecting = false
      }
    },

    // nostrconnect:// — generate a pairing URI + QR; the signer connects to us
    // and the auth-state subscription finishes the login.
    async startNostrConnect() {
      this.signerError = ''
      const auth = getAuthManager()
      if (!auth) {
        this.signerError = 'signer not ready, please reload'
        return
      }
      this.startingPairing = true
      try {
        const { uri } = await auth.startNip46PairingUniversal()
        this.nostrconnectUri = uri
        this.pairingStatus = 'waiting for approval…'
      } catch (err) {
        this.signerError = err?.message || 'could not start pairing'
      } finally {
        this.startingPairing = false
      }
    },

    openInSignerApp() {
      if (this.nostrconnectUri) window.open(this.nostrconnectUri, '_self')
    },

    copyNostrconnect() {
      if (!this.nostrconnectUri) return
      copyToClipboard(this.nostrconnectUri).then(() =>
        Notify.create({ message: 'connection string copied' })
      )
    },
  },
})
</script>

<style lang='css' scoped>
.q-card {
  background: var(--q-background);
  padding: 1rem;
}
</style>

<style lang='css'>
.relay-list {
  column-width: 15rem;
  column-gap: .5rem;
  width: 100%;
  min-height: 1px;
  font-size: .8rem;
  white-space: nowrap;
  padding: 0 .5rem;
  border-radius: .5rem;
  overflow-y: auto;
  overflow-x: hidden;
}
.relay-item {
  overflow: auto;
}
#new-relay-input {
   background: rgba(0, 0, 0, 0.05);
   border-radius: .3rem;
   padding: 0 0 0 .5rem;
}
.body--dark #new-relay-input {
   background: rgba(255, 255, 255, 0.08);
}
#new-relay-input .q-field--dense .q-field__control {
  height: 1.4rem !important;
}
</style>
