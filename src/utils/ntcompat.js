// nostr-tools v1 → v2 compatibility shim.
//
// The 2022 codebase was written against nostr-tools 1.5.0, whose API drifted
// in v2: `signEvent`/`generatePrivateKey` were removed, `nip06` moved to a
// subpath, and `getPublicKey` now takes a Uint8Array instead of a hex string.
// Rather than touch every legacy call site, the handful of files that use the
// changed surface import these v1-shaped wrappers. New code should import from
// nostr-tools v2 (or the NDK signer layer) directly.

import {
  getPublicKey as _getPublicKey,
  getEventHash,
  generateSecretKey,
  finalizeEvent
} from 'nostr-tools'
import * as nip06 from 'nostr-tools/nip06'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

export { getEventHash, nip06 }

// v1 derived the key in two steps (seedFromWords → privateKeyFromSeed); v2
// collapses that into privateKeyFromSeedWords, which returns bytes. The rest of
// the app stores/uses the private key as hex, so normalize to hex here.
export function privateKeyFromSeedWords(mnemonic, passphrase, accountIndex) {
  const sk = nip06.privateKeyFromSeedWords(mnemonic, passphrase, accountIndex)
  return typeof sk === 'string' ? sk : bytesToHex(sk)
}

// v1 returned the secret key as hex; v2's generateSecretKey returns bytes.
export function generatePrivateKey() {
  return bytesToHex(generateSecretKey())
}

// v1 getPublicKey accepted a hex string; v2 wants bytes.
export function getPublicKey(sk) {
  return _getPublicKey(typeof sk === 'string' ? hexToBytes(sk) : sk)
}

// v1 signEvent(event, hexKey) returned just the signature. Reconstruct it via
// v2's finalizeEvent, which recomputes id + sig over the event template.
export function signEvent(event, sk) {
  const key = typeof sk === 'string' ? hexToBytes(sk) : sk
  const signed = finalizeEvent(
    {
      kind: event.kind,
      created_at: event.created_at,
      tags: event.tags,
      content: event.content
    },
    key
  )
  return signed.sig
}
