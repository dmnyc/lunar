// NIP-46 JSON-RPC helpers for callers that need raw RPC access (e.g.
// encryptionService nip44_encrypt/decrypt).
//
// Supports the nostr-tools BunkerSigner path (via Nip46NdkSigner.bunkerSigner)
// used after the NDKNip46Signer → BunkerSigner migration. The old NDK signer
// path is kept as a fallback for any code that hasn't been updated yet.

const DEFAULT_TIMEOUT_MS = 15000

function getOldChannel(signer) {
  if (!signer.rpc || typeof signer.rpc.sendRequest !== 'function') {
    throw new Error('NIP-46 signer RPC channel not available')
  }
  if (!signer.remotePubkey) {
    throw new Error('NIP-46 signer remote pubkey not resolved')
  }
  return { rpc: signer.rpc, remotePubkey: signer.remotePubkey }
}

export async function sendNip46Rpc(signer, method, params, timeoutMs = DEFAULT_TIMEOUT_MS) {
  // nostr-tools BunkerSigner path (Nip46NdkSigner wraps bunkerSigner)
  if (signer?.bunkerSigner) {
    return Promise.race([
      signer.bunkerSigner.sendRequest(method, params),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs)
      )
    ])
  }

  // Legacy NDK NDKNip46Signer path
  const { rpc, remotePubkey } = getOldChannel(signer)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs)
    try {
      rpc.sendRequest(remotePubkey, method, params, 24133, (response) => {
        clearTimeout(timer)
        if (response?.error) {
          reject(new Error(`${method}: ${response.error}`))
          return
        }
        if (typeof response?.result !== 'string') {
          reject(new Error(`${method}: malformed response (missing result)`))
          return
        }
        resolve(response.result)
      })
    } catch (e) {
      clearTimeout(timer)
      reject(e)
    }
  })
}

export async function fetchNip46UserPubkey(signer, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const result = await sendNip46Rpc(signer, 'get_public_key', [], timeoutMs)
  const pubkey = result.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    throw new Error(`get_public_key invalid response: ${result}`)
  }
  return pubkey
}

export async function nip44EncryptViaNip46(signer, recipientPubkey, plaintext, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (signer?.bunkerSigner) {
    return Promise.race([
      signer.bunkerSigner.nip44Encrypt(recipientPubkey, plaintext),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('nip44_encrypt timed out')), timeoutMs)
      )
    ])
  }
  return sendNip46Rpc(signer, 'nip44_encrypt', [recipientPubkey, plaintext], timeoutMs)
}

export async function nip44DecryptViaNip46(signer, senderPubkey, ciphertext, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (signer?.bunkerSigner) {
    return Promise.race([
      signer.bunkerSigner.nip44Decrypt(senderPubkey, ciphertext),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('nip44_decrypt timed out')), timeoutMs)
      )
    ])
  }
  return sendNip46Rpc(signer, 'nip44_decrypt', [senderPubkey, ciphertext], timeoutMs)
}
