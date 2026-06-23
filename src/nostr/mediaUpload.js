// Image upload to nostr.build with NIP-98 auth.
//
// Follows the zapcooking/sidecar approach: a freshly-stamped kind-27235 event
// is signed and base64'd into the Authorization header. We sign via the store's
// signAsynchronously so it works across every signer type (local key, NIP-07,
// NIP-46), retrying once on an auth failure (a slow remote signer can produce a
// token that lands just outside nostr.build's freshness window).

import { signAsynchronously } from '../utils/event'

const NOSTR_BUILD_URL = 'https://nostr.build/api/v2/upload/files'
const MAX_IMAGE_SIZE = 25 * 1024 * 1024 // 25MB

async function buildAuthHeader(store, url) {
  const now = Math.floor(Date.now() / 1000)
  const event = {
    kind: 27235,
    created_at: now,
    content: '',
    tags: [
      ['u', url],
      ['method', 'POST'],
      ['expiration', String(now + 60)]
    ],
    pubkey: store.state.keys.pub
  }
  const signed = await signAsynchronously(event, store)
  return `Nostr ${btoa(JSON.stringify(signed))}`
}

function isAuthFailure(status, bodyText) {
  if (status === 401 || status === 403) return true
  return /nip[\s-]?98|unauthor|expired|timestamp|created_at|invalid auth/i.test(bodyText || '')
}

// Upload one image File, returning its hosted URL.
export async function uploadImage(store, file) {
  if (!store.state.keys.pub) throw new Error('you must be signed in to upload')
  if (file.size > MAX_IMAGE_SIZE) throw new Error('image must be less than 25MB')

  const url = NOSTR_BUILD_URL
  const attempt = async () => {
    const body = new FormData()
    body.append('file[]', file)
    const authorization = await buildAuthHeader(store, url)
    return fetch(url, { method: 'POST', body, headers: { Authorization: authorization } })
  }

  let res = await attempt()
  if (!res.ok) {
    const firstText = await res.text()
    if (isAuthFailure(res.status, firstText)) {
      res = await attempt()
      if (!res.ok) throw new Error(`upload failed (${res.status})`)
    } else {
      throw new Error(`upload failed (${res.status})`)
    }
  }

  const result = await res.json()
  const link = result?.data?.[0]?.url
  if (link) return link
  throw new Error(result?.message || result?.error || 'upload failed')
}
