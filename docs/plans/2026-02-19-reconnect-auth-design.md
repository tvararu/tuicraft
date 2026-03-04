# Reconnect Challenge/Proof Auth Flow

When the auth server has a stale session for an account, it sends
RECONNECT_CHALLENGE (0x02) instead of LOGON_CHALLENGE (0x00). The current
auth state machine doesn't recognize this opcode and silently hangs until
timeout. This design adds the full reconnect protocol with a retry-with-backoff
fallback for fresh process starts that lack a cached session key.

## Protocol

The reconnect flow replaces the SRP-6 exchange with an MD5-based proof using
the previously-computed 40-byte session key K.

### RECONNECT_CHALLENGE (Server -> Client, opcode 0x02)

| Offset | Size | Description |
|--------|------|-------------|
| 0 | 1 | opcode = 0x02 |
| 1 | 1 | status (0x00 = success) |
| 2 | 16 | challengeData (random nonce) |
| 18 | 2 | padding (uint16LE) |
| 20 | 4 | padding (uint32LE) |

Total: 24 bytes on success.

### RECONNECT_PROOF (Client -> Server, opcode 0x03)

| Offset | Size | Description |
|--------|------|-------------|
| 0 | 1 | opcode = 0x03 |
| 1 | 16 | clientData (16 random bytes) |
| 17 | 20 | proof = MD5(account + challengeData + clientData + sessionKey) |
| 37 | 20 | keyData (20 zero bytes) |
| 57 | 1 | numKeys = 0x00 |

Total: 58 bytes. The proof is padded from 16 to 20 bytes with 4 trailing zeros.

### RECONNECT_PROOF Response (Server -> Client)

| Offset | Size | Description |
|--------|------|-------------|
| 0 | 1 | opcode = 0x03 |
| 1 | 1 | result (0x00 = success) |

On success, proceed to REALM_LIST. On failure, close.

## Architecture

### Protocol layer (src/wow/protocol/opcodes.ts, auth.ts)

Add `RECONNECT_CHALLENGE: 0x02` and `RECONNECT_PROOF: 0x03` to `AuthOpcode`.

`parseReconnectChallengeResponse(r: PacketReader)` reads status, on success
reads 16-byte challengeData and skips 6 bytes padding. Returns
`{ status, challengeData? }`.

`buildReconnectProof(account, challengeData, sessionKey, clientData?)` generates
16 random client bytes (or uses injected clientData for test determinism),
computes `MD5(account + challengeData + clientData + sessionKey)`, pads the
16-byte digest to 20 bytes, and builds the 58-byte packet.

### Auth state machine (src/wow/client.ts)

`ClientConfig` gains optional `cachedSessionKey?: Uint8Array`.

In the `"challenge"` state, peek byte 0:
- 0x00: existing logon challenge path (unchanged)
- 0x02: if cachedSessionKey exists, parse reconnect challenge, build reconnect
  proof, transition to `"reconnect_proof"` state. If no cached K, throw
  `ReconnectRequiredError`.

New `"reconnect_proof"` state: parse 2-byte response. On status 0x00, request
realm list and transition to `"realms"`. On failure, throw.

Export `ReconnectRequiredError extends Error`.

### Retry in callers (src/wow/client.ts)

Export `authWithRetry(config, maxAttempts?)` that wraps `authHandshake` in a
loop. On `ReconnectRequiredError`, wait with exponential backoff
(5s, 10s, 20s, 40s, 60s cap), then retry. Both `main.ts` and `daemon/server.ts`
call `authWithRetry` instead of `authHandshake` directly.

### Mock auth server (src/test/mock-auth-server.ts)

Add a `reconnect?: { challengeData: Uint8Array; sessionKey: Uint8Array }` option.
When set, the server sends RECONNECT_CHALLENGE instead of LOGON_CHALLENGE and
validates the reconnect proof against the expected MD5 computation.

## Testing

Unit tests in auth.test.ts:
- parseReconnectChallengeResponse: success path, error status path
- buildReconnectProof: deterministic output with injected clientData, verify
  packet layout and MD5 computation

Integration tests in client.test.ts:
- Full authHandshake through reconnect flow with mock auth server
- ReconnectRequiredError thrown when no cachedSessionKey
- authWithRetry retries on ReconnectRequiredError (mock server sends reconnect
  first, then logon on second connection)

bugs.md checkbox gets checked after implementation.
