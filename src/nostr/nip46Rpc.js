// Low-level NIP-46 JSON-RPC helpers.
//
// NDK's NDKNip46Signer only wraps a subset of NIP-46 methods. For methods it
// doesn't expose (get_public_key, nip44_encrypt/decrypt) we drive the signer's
// already-connected RPC channel (signer.rpc) directly.
//
// Ported from zapcooking src/lib/nip46Rpc.ts.

const NIP46_KIND = 24133
const DEFAULT_TIMEOUT_MS = 15000

function getChannel(signer) {
  if (!signer.rpc || typeof signer.rpc.sendRequest !== 'function') {
    throw new Error('NIP-46 signer RPC channel not available')
  }
  if (!signer.remotePubkey) {
    throw new Error('NIP-46 signer remote pubkey not resolved')
  }
  return { rpc: signer.rpc, remotePubkey: signer.remotePubkey }
}

// Issue a NIP-46 JSON-RPC request and resolve with the result string. An
// explicit empty-string result is valid; a missing/non-string result with no
// error is treated as a protocol failure.
export async function sendNip46Rpc(signer, method, params, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { rpc, remotePubkey } = getChannel(signer)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs)
    try {
      rpc.sendRequest(remotePubkey, method, params, NIP46_KIND, (response) => {
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

// Resolve the user's actual pubkey via get_public_key. NDK's signer.user() is
// synchronous and returns the signer service pubkey from the constructor, not
// the user identity — using it logs sessions in as the signer service.
export async function fetchNip46UserPubkey(signer, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const result = await sendNip46Rpc(signer, 'get_public_key', [], timeoutMs)
  const pubkey = result.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    throw new Error(`get_public_key invalid response: ${result}`)
  }
  return pubkey
}

export async function nip44EncryptViaNip46(signer, recipientPubkey, plaintext, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return sendNip46Rpc(signer, 'nip44_encrypt', [recipientPubkey, plaintext], timeoutMs)
}

export async function nip44DecryptViaNip46(signer, senderPubkey, ciphertext, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return sendNip46Rpc(signer, 'nip44_decrypt', [senderPubkey, ciphertext], timeoutMs)
}
