// Thin NDK signer adapter wrapping a nostr-tools BunkerSigner.
//
// Root cause of the NDKNip46Signer hang: NDK's sign() sends a sign_event RPC
// and waits for the response via a callback registered on the rpc EventEmitter
// (this.once(`response-${id}`)). That event is only emitted when startListening()
// sets up an NDK subscription. But startListening() is only called from
// blockUntilReady() — which we bypass because it awaits a "connect" response
// that many signers (Amber) never send.
//
// nostr-tools BunkerSigner.fromBunker() calls setupSubscription() immediately,
// so the response listener is always active before any RPC call. No hang.

import ndk from './ndk'

export class Nip46NdkSigner {
  constructor(bunkerSigner, userPubkey) {
    this.bunkerSigner = bunkerSigner
    this.userPubkey = userPubkey
  }

  async user() {
    return ndk.getUser({ pubkey: this.userPubkey })
  }

  // NDK signer interface: returns just the sig string.
  async sign(event) {
    const signed = await this.bunkerSigner.signEvent(event)
    return signed.sig
  }

  // NIP-04 encrypt/decrypt for NDK DM flows.
  async encrypt(recipient, value) {
    return this.bunkerSigner.nip04Encrypt(recipient.pubkey, value)
  }

  async decrypt(sender, value) {
    return this.bunkerSigner.nip04Decrypt(sender.pubkey, value)
  }

  // NIP-44 encrypt/decrypt — called by encryptionService for self-encryption.
  async nip44Encrypt(pubkey, plaintext) {
    return this.bunkerSigner.nip44Encrypt(pubkey, plaintext)
  }

  async nip44Decrypt(pubkey, ciphertext) {
    return this.bunkerSigner.nip44Decrypt(pubkey, ciphertext)
  }
}
