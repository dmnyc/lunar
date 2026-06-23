// NIP-44-aware local signer for NIP-46 RPC channels.
//
// NIP-46 mandates that the JSON-RPC `content` carried by kind:24133 events is
// NIP-44 encrypted. NDK 2.10's default local signer (NDKPrivateKeySigner)
// implements encrypt/decrypt with NIP-04 only, so modern signers (Primal,
// current Amber) that reply with NIP-44 silently fail to decrypt and our
// blockUntilReady / get_public_key calls hang. This wrapper substitutes
// nip44.v2 on encrypt and tries nip44 first / nip04 fallback on decrypt.
//
// Pass an instance as the `localSigner` argument to NDKNip46Signer only — never
// as a user-facing signer for the user's own events.
//
// Ported from zapcooking src/lib/nip44LocalSigner.ts.

import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk'
import * as nip44 from 'nostr-tools/nip44'
import * as nip04 from 'nostr-tools/nip04'
import { hexToBytes } from '@noble/hashes/utils'

export class Nip44LocalSigner extends NDKPrivateKeySigner {
  async encrypt(recipient, value) {
    const hex = this.privateKey
    if (!hex) throw new Error('Nip44LocalSigner: private key not available')
    const conversationKey = nip44.v2.utils.getConversationKey(hexToBytes(hex), recipient.pubkey)
    return nip44.v2.encrypt(value, conversationKey)
  }

  async decrypt(sender, value) {
    const hex = this.privateKey
    if (!hex) throw new Error('Nip44LocalSigner: private key not available')

    try {
      const conversationKey = nip44.v2.utils.getConversationKey(hexToBytes(hex), sender.pubkey)
      return nip44.v2.decrypt(value, conversationKey)
    } catch (nip44Error) {
      try {
        return await nip04.decrypt(hex, sender.pubkey, value)
      } catch {
        throw nip44Error
      }
    }
  }
}
