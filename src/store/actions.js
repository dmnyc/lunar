import {nip04, nip05} from 'nostr-tools'
import {Notify, debounce} from 'quasar'
import {signAsynchronously} from '../utils/event'
import {
  getProfiles,
  dbProfile,
  getEvents,
  dbEvent,
  dbFollows,
  dbRelayList,
  streamMainProfilesFollows,
  dbQuery,
  dbSave,
  publish,
} from '../query'
import {addRelays} from '../nostr/ndk'
import {getPubKeyTagWithRelay} from '../utils/helpers'
import {metadataFromEvent} from '../utils/event'
import * as helpersMixin from '../utils/mixin'

export function initKeys(store, keys) {
  // passing no arguments will cause a new seed to be generated
  store.commit('setKeys', keys)

  // also initialize the lastNotificationRead value
  store.commit('haveReadNotifications')
}

export async function launch(store) {
  console.log('launch for ', store.state.keys.pub)

  // adopt the user's NIP-65 relays first, then start subscriptions on them
  await store.dispatch('loadRelayList')

  // start listening for nostr events
  store.dispatch('restartMainSubscription')
}

// Fetch the user's NIP-65 (kind 10002) relay list and adopt it as the active
// relay set. Modern clients publish relays here rather than in kind-3 content.
export async function loadRelayList(store) {
  if (!store.state.keys.pub) return
  try {
    const event = await dbRelayList(store.state.keys.pub)
    if (!event || !event.tags) return

    const relays = {}
    for (const [t, url, marker] of event.tags) {
      if (t !== 'r' || !url) continue
      // No marker → both read and write (per NIP-65).
      relays[url] = {
        read: marker !== 'write',
        write: marker !== 'read'
      }
    }
    if (Object.keys(relays).length) {
      store.commit('setRelays', relays)
      addRelays(Object.keys(relays))
    }
  } catch (err) {
    console.warn('[loadRelayList] failed', err)
  }
}

let mainSub = {}
// Tracks the newest kind-3 created_at we've adopted. Replaces the old SQL
// created_at lookup so a relay serving a stale contact list can't clobber a
// newer follows set.
let latestContactListAt = 0
export async function restartMainSubscription(store) {
  // get relays
  let relays = Object.keys(store.state.relays).length ? Object.keys(store.state.relays) : Object.keys(store.state.defaultRelays)

  // create list of users we want profile and follows events for
  let authors = [
    store.state.keys.pub, // main user
    ...store.state.follows, // our follows
    '29f63b70d8961835b14062b195fc7d84fa810560b36dde0749e4bc084f0f8952', // bot tracker follows (to filter out bots in feed)
  ]
  // create or update main profiles and follows sup
  if (!mainSub.streamMainProfilesFollows) mainSub.streamMainProfilesFollows = await streamMainProfilesFollows(
    { authors, relays, user: store.state.keys.pub },
    async events => {
      // console.log('streamMainProfilesFollows', events)
      for (let event of events) {
        if (event.kind === 0) {
          store.dispatch('handleAddingProfileEventToCache', event)
        } else if (event.pubkey === store.state.keys.pub && event.kind === 3) {
          // Skip stale/duplicate contact lists (relays may resend older ones).
          if (event.created_at <= latestContactListAt) continue
          latestContactListAt = event.created_at

          // Legacy astral stored the relay list as JSON in kind-3 content;
          // modern kind-3 events leave content empty (relays live in NIP-65
          // kind-10002). Only adopt content when it actually parses — a bad or
          // empty content must never abort the follows update below.
          if (event.content && event.content.trim()) {
            try {
              store.commit('setRelays', JSON.parse(event.content))
            } catch (_) {
              /* not legacy relay JSON — ignore */
            }
          }

          let follows = event.tags
            .filter(([t, v]) => t === 'p' && v)
            .map(([_, v]) => v)
          store.commit('setFollows', follows)
          store.dispatch('restartMainSubscription')
        }
      }
    }
  )
  else mainSub.streamMainProfilesFollows.update({ authors, relays, user: store.state.keys.pub })
}

export async function addEvent(store, {event, relay = null}) {
  await dbSave(event, relay)
}

export async function sendPost(store, {message, tags = [], kind = 1}) {
  if (message.length === 0) return

  // try {
    const unpublishedEvent = {
      pubkey: store.state.keys.pub,
      created_at: Math.floor(Date.now() / 1000),
      kind,
      tags,
      content: message
    }

    let result = await store.dispatch('publishEvent', {unpublishedEvent})
    console.log('sendPost result', result)
    return result
  //   let event = await signAsynchronously(unpublishedEvent, store)
  //   let publishResult = await publish(event)
  //   if (!publishResult) throw new Error('could not publish post')
  //   store.dispatch('addEvent', {event})
  //   return event
  // } catch (error) {
  //   Notify.create({
  //     message: `could not publish post: ${error}`,
  //     color: 'negative'
  //   })
  //   return
  // }
}

export async function sendChatMessage(store, {now, pubkey, text, tags}) {
  if (text.length === 0) return

  let ciphertext = '???'
  try {
    if (store.state.keys.priv) {
      ciphertext = await nip04.encrypt(store.state.keys.priv, pubkey, text)
    } else if (
      (await window?.nostr?.getPublicKey?.()) === store.state.keys.pub
    ) {
      ciphertext = await window.nostr.nip04.encrypt(pubkey, text)
    } else {
      throw new Error('no private key available to encrypt!')
    }

    let unpublishedEvent = {
      pubkey: store.state.keys.pub,
      created_at: now,
      kind: 4,
      tags,
      content: ciphertext
    }
    return await store.dispatch('publishEvent', {unpublishedEvent})

    // let event = await signAsynchronously(unpublishedEvent, store)
    // let publishResult = await publish(event)
    // if (!publishResult) throw new Error('could not publish message')
    // store.dispatch('addEvent', {event})
    // return event
  } catch (error) {
    Notify.create({
      message: `could not encrypt message: ${error}`,
      color: 'negative'
    })
    return
  }
}

export async function publishContactList(store) {
  // extend the existing tags
  let [oldEvent] = await dbFollows(store.state.keys.pub)
  console.log('oldEvent poblishContactList', oldEvent)
  var tags = oldEvent?.tags || []

  // check existing event because it might contain more data in the
  // tags that we don't want to replace, if so push existing event tag,
  // else push state.follows tag
  let newTags = []
  await Promise.all(
    store.state.follows.map(async pubkey => {
      let index = tags.findIndex(([t, v]) => t === 'p' && v === pubkey)
      if (index >= 0) {
        newTags.push(tags[index])
      } else {
        newTags.push(await getPubKeyTagWithRelay(pubkey))
      }
    })
  )

  // try {
    let unpublishedEvent = {
      pubkey: store.state.keys.pub,
      created_at: Math.floor(Date.now() / 1000),
      kind: 3,
      tags: newTags,
      content: JSON.stringify(store.state.relays)
    }
    return await store.dispatch('publishEvent', {unpublishedEvent})

  //   let event = await signAsynchronously(unpublishedEvent, store)
  //   let publishResult = await publish(event)
  //   if (!publishResult) throw new Error('could not publish updated list of followed keys and relays')
  //   store.dispatch('addEvent', {event})

  //   let relays, follows
  //   relays = JSON.parse(event.content)
  //   follows = event.tags
  //     .filter(([t, v]) => t === 'p' && v)
  //     .map(([_, v]) => v)

  //   // update store state
  //   store.commit('setFollows', follows)
  //   store.commit('setRelays', relays)

  //   await store.dispatch('addEvent', {event})

  //   Notify.create({
  //     message: 'updated and published list of followed keys and relays.',
  //     color: 'positive'
  //   })
  //   return event
  // } catch (error) {
  //   Notify.create({
  //     message: `could not publish updated list of followed keys and relays: ${error}`,
  //     color: 'negative'
  //   })
  //   return
  // }
}

export async function setMetadata(store, metadata) {
  if (metadata.created_at) delete metadata.created_at
  // try {
    let unpublishedEvent = {
      pubkey: store.state.keys.pub,
      created_at: Math.floor(Date.now() / 1000),
      kind: 0,
      tags: [],
      content: JSON.stringify(metadata)
    }
    return await store.dispatch('publishEvent', {unpublishedEvent})
  //   let event = await signAsynchronously(unpublishedEvent, store)
  //   let publishResult = await publish(event)
  //   if (!publishResult) throw new Error('could not publish updated profile event')
  //   store.dispatch('addEvent', {event})
  //   store.dispatch('handleAddingProfileEventToCache', event)

  //   Notify.create({
  //     message: 'updated and published profile',
  //     color: 'positive'
  //   })
  //   return event
  // } catch (error) {
  //   Notify.create({
  //     message: `could not publish updated profile: ${error}`,
  //     color: 'negative'
  //   })
  //   return
  // }
}

export async function recommendRelay(store, url) {
  // try {
    let unpublishedEvent = {
      pubkey: store.state.keys.pub,
      created_at: Math.round(Date.now() / 1000),
      kind: 2,
      tags: [],
      content: url
    }
    return await store.dispatch('publishEvent', {unpublishedEvent})
  //   let event = await signAsynchronously(unpublishedEvent, store)
  //   let publishResult = await publish(event)
  //   if (!publishResult) throw new Error('could not publish recommend relay event')
  //   store.dispatch('addEvent', {event})
  //   return event
  // } catch (error) {
  //   Notify.create({
  //     message: `could not publish recommend relay event: ${error}`,
  //     color: 'negative'
  //   })
  //   return
  // }
}

export async function publishEvent(store, {unpublishedEvent}) {
  let relays = Object.keys(store.state.relays).length ? Object.keys(store.state.relays) : Object.keys(store.state.defaultRelays)
  let eventTypeWordy
  switch (unpublishedEvent.kind) {
    case 0:
      eventTypeWordy = 'profile information'
      break
    case 1:
      eventTypeWordy = 'note'
      break
    case 2:
      eventTypeWordy = 'recommend relay'
      break
    case 3:
      eventTypeWordy = 'follows and relay list'
      break
    case 4:
      eventTypeWordy = 'dm'
      break
    default:
      eventTypeWordy = `kind ${unpublishedEvent.kind}`
  }
  // NIP-89 client tag — identifies lunar as the publishing client. Added
  // before signing so it's covered by the signature. Skipped for kind 4 DMs
  // (no client fingerprint on private messages) and never duplicated.
  if (
    unpublishedEvent.kind !== 4 &&
    !(unpublishedEvent.tags || []).some((t) => t[0] === 'client')
  ) {
    unpublishedEvent.tags = [...(unpublishedEvent.tags || []), ['client', 'lunar']]
  }

  try {
    let event = await signAsynchronously(unpublishedEvent, store)
    let publishResult = await publish(event, relays)
    if (!publishResult) console.log(`no publish confirmation for ${eventTypeWordy} event`)
    await store.dispatch('addEvent', {event})
    if (event.kind === 0) store.dispatch('handleAddingProfileEventToCache', event)
    else if (event.kind === 3) {
      let relays, follows
      relays = JSON.parse(event.content)
      follows = event.tags
        .filter(([t, v]) => t === 'p' && v)
        .map(([_, v]) => v)

      // update store state
      store.commit('setFollows', follows)
      store.commit('setRelays', relays)
    }
    if ([0, 3].includes(event.kind)) {
      Notify.create({
        message: `published updated ${eventTypeWordy} event`,
        color: 'positive'
      })
    }
    return event
  } catch (error) {
    console.log(`could not publish ${eventTypeWordy} event: ${error}`)
    Notify.create({
      message: `could not publish ${eventTypeWordy} event: ${error}`,
      color: 'negative'
    })
    return
  }
}

const debouncedGetProfiles = debounce(async (store) => {
  if (!gettingProfiles) getQueuedProfiles(store)
}, 1000)

async function getQueuedProfiles(store) {
  if (profilesQueue.length) {
    gettingProfiles = true
    let relays = Object.keys(store.state.relays).length ? Object.keys(store.state.relays) : Object.keys(store.state.defaultRelays)
    let authors = profilesQueue.splice(0, 50)
    while (authors && authors.length) {
      let events = await getProfiles({authors, relays})
      if (events) for (let event of events) store.dispatch('handleAddingProfileEventToCache', event)
      authors = profilesQueue.splice(0, 50)
    }
    gettingProfiles = false
  }
}

// let profilesInUse = {}
let profilesQueue = []
let gettingProfiles = false
export async function useProfile(store, {pubkey}) {
  if (!helpersMixin.default.methods.isKey(pubkey)) return
  if (pubkey in store.state.profilesCache) {
    // we don't fetch again, but we do commit this so the LRU gets updated
    store.commit('addProfileToCache', {
      pubkey,
      ...store.state.profilesCache[pubkey]
    }) // (just the pubkey is enough)
  } else {
    // fetch from db and add to cache
    let event = await dbProfile(pubkey)
    if (event) {
      store.dispatch('handleAddingProfileEventToCache', event)
    } else {
      profilesQueue.push(pubkey)
      debouncedGetProfiles(store)
    }
  }
}

const debouncedGetEvents = debounce(async (store) => {
  if (!gettingEvents) getQueuedEvents(store)
}, 1000)

async function getQueuedEvents(store) {
  if (eventsQueue.length) {
    gettingEvents = true
    let relays = Object.keys(store.state.relays).length ? Object.keys(store.state.relays) : Object.keys(store.state.defaultRelays)
    let ids = eventsQueue.splice(0, 50)
    while (ids && ids.length) {
      let events = await getEvents({ids, relays})
      if (events) for (let event of events) {
        if (event.kind === 1 || event.kind === 2) helpersMixin.default.methods.interpolateEventMentions(event, store)
        else if (event.kind === 4) {
          event.text = await helpersMixin.default.methods.getPlaintext(event, store)
          helpersMixin.default.methods.interpolateMessageMentions(event, store)
        }
        store.commit('addEventToCache', event)
        store.dispatch('useProfile', { pubkey: event.pubkey })
      }
      ids = eventsQueue.splice(0, 50)
    }
    gettingEvents = false
  }
}

let eventsQueue = []
let gettingEvents = false
export async function useEvent(store, {id}) {
  if (!helpersMixin.default.methods.isKey(id)) return
  if (id in store.state.eventsCache) {
    // we don't fetch again, but we do commit this so the LRU gets updated
    store.commit('addEventToCache', {...store.state.eventsCache[id]})
  } else {
    // fetch from db and add to cache
    let event = await dbEvent(id)
    if (event) {
      if (event.kind === 1 || event.kind === 2) helpersMixin.default.methods.interpolateEventMentions(event, store)
      else if (event.kind === 4) {
        event.text = await helpersMixin.default.methods.getPlaintext(event, store)
        helpersMixin.default.methods.interpolateMessageMentions(event, store)
      }
      store.commit('addEventToCache', event)
      store.dispatch('useProfile', { pubkey: event.pubkey })
    } else {
      eventsQueue.push(id)
      debouncedGetEvents(store)
    }
  }
}

export async function useNip05(store, {metadata}) {
  if (metadata.nip05 === '') delete metadata.nip05

  if (metadata.nip05) {
    let cached = store.state.nip05VerificationCache[metadata.nip05]
    if (cached && cached.when > Date.now() / 1000 - 60 * 60) {
      if (cached.pubkey !== metadata.pubkey) delete metadata.nip05
    } else {
      let pubkey
      try {
        let profile = await nip05.queryProfile(metadata.nip05)
        pubkey = profile.pubkey
        store.commit('addToNIP05VerificationCache', {
          pubkey,
          identifier: metadata.nip05
        })
      } catch (_) {
        pubkey = ''
      }
      if (metadata.pubkey !== pubkey) delete metadata.nip05
    }
  }
  store.commit('addProfileToCache', metadata)
}

export async function handleAddingProfileEventToCache(store, event) {
  if (store.state.profilesCache[event.pubkey] && event.created_at <= store.state.profilesCache[event.pubkey].created_at) return
  let metadata = metadataFromEvent(event)
  store.commit('addProfileToCache', metadata)
  store.dispatch('useNip05', {metadata})
}
