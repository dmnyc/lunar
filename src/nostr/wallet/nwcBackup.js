// Back up / restore the NWC connection string to Nostr relays via NIP-78
// (kind 30078 replaceable app-data), NIP-44 encrypted to the user's own key.
//
// Signs through Lunar's normal path (signAsynchronously → query.publish) so it
// works for local-key users too (their key isn't on ndk.signer).

import ndk, { connect, relaySetFrom } from '../ndk'
import { NDKSubscriptionCacheUsage } from '@nostr-dev-kit/ndk'
import { signAsynchronously } from '../../utils/event'
import { publish } from '../../query'
import { encryptSelf, decryptSelf, canBackup } from '../encryptionService'

const KIND = 30078
const D_TAG = 'lunar-nwc-backup'

export { canBackup }

function userRelays(store) {
  const r = Object.keys(store.state.relays || {})
  return r.length ? r : Object.keys(store.state.defaultRelays || {})
}

// Fetch the newest backup event (subscription + EOSE/timeout — NDK fetchEvents
// can hang on tag filters).
function fetchBackupEvent(store) {
  return new Promise((resolve) => {
    let newest = null
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { sub.stop() } catch (_) { /* ignore */ }
      resolve(newest)
    }
    const sub = ndk.subscribe(
      { kinds: [KIND], authors: [store.state.keys.pub], '#d': [D_TAG] },
      { closeOnEose: true, groupable: false, cacheUsage: NDKSubscriptionCacheUsage.PARALLEL },
      relaySetFrom(userRelays(store))
    )
    sub.on('event', (e) => {
      const raw = e.rawEvent ? e.rawEvent() : e
      if (!newest || raw.created_at > newest.created_at) newest = raw
    })
    sub.on('eose', finish)
    const timer = setTimeout(finish, 5000)
  })
}

// Encrypt + publish the connection string as a replaceable kind-30078 event.
export async function backupNwcToNostr(store, connectionString) {
  if (!connectionString) throw new Error('no NWC connection string to back up')
  if (!canBackup(store)) throw new Error('current signer cannot encrypt a backup')
  await connect()

  const ciphertext = await encryptSelf(store, connectionString)
  const event = {
    kind: KIND,
    created_at: Math.round(Date.now() / 1000),
    pubkey: store.state.keys.pub,
    content: ciphertext,
    tags: [
      ['d', D_TAG],
      ['client', 'lunar'],
      ['encryption', 'nip44']
    ]
  }
  const signed = await signAsynchronously(event, store)
  const ok = await publish(signed, userRelays(store))
  if (!ok) throw new Error('could not publish backup to relays')
  return signed
}

// Returns the decrypted NWC connection string, or null if no backup found.
export async function restoreNwcFromNostr(store) {
  await connect()
  const event = await fetchBackupEvent(store)
  if (!event || !event.content) return null

  const connectionString = await decryptSelf(store, event.content)
  if (
    !connectionString ||
    !/nostr(\+walletconnect)?:/i.test(connectionString) && !/nostrwalletconnect:/i.test(connectionString)
  ) {
    throw new Error('decrypted backup is not a valid NWC connection string')
  }
  return connectionString
}

export async function hasNwcBackup(store) {
  await connect()
  const event = await fetchBackupEvent(store)
  return !!(event && event.content)
}

// Overwrite the backup with an empty replaceable event.
export async function deleteNwcBackup(store) {
  await connect()
  const event = {
    kind: KIND,
    created_at: Math.round(Date.now() / 1000),
    pubkey: store.state.keys.pub,
    content: '',
    tags: [
      ['d', D_TAG],
      ['deleted', 'true']
    ]
  }
  const signed = await signAsynchronously(event, store)
  await publish(signed, userRelays(store))
}
