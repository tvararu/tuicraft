# Reconnect Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Handle RECONNECT_CHALLENGE/PROOF auth opcodes so quick reconnects don't silently hang.

**Architecture:** Add reconnect packet builders/parsers to the protocol layer, extend the auth state machine with a reconnect path and `ReconnectRequiredError`, add `authWithRetry` wrapper with exponential backoff.

**Tech Stack:** TypeScript, Bun, node:crypto (MD5)

---

### Task 1: Add reconnect opcodes

**Files:**
- Modify: `src/wow/protocol/opcodes.ts:1-5`

**Step 1: Add RECONNECT_CHALLENGE and RECONNECT_PROOF to AuthOpcode**

```typescript
export const AuthOpcode = {
  LOGON_CHALLENGE: 0x00,
  LOGON_PROOF: 0x01,
  RECONNECT_CHALLENGE: 0x02,
  RECONNECT_PROOF: 0x03,
  REALM_LIST: 0x10,
} as const;
```

**Step 2: Run typecheck**

Run: `mise typecheck`
Expected: PASS (no consumers of the new opcodes yet)

**Step 3: Commit**

```
feat: Add RECONNECT_CHALLENGE and RECONNECT_PROOF auth opcodes
```

---

### Task 2: Reconnect challenge parser — tests first

**Files:**
- Modify: `src/wow/protocol/auth.test.ts`
- Modify: `src/wow/protocol/auth.ts`

**Step 1: Write failing tests for parseReconnectChallengeResponse**

Add to `auth.test.ts`:

```typescript
test("parseReconnectChallengeResponse extracts challenge data on success", () => {
  const w = new PacketWriter();
  w.uint8(0x00);
  w.uint8(0x00);
  const challengeData = new Uint8Array(16);
  for (let i = 0; i < 16; i++) challengeData[i] = i + 0xa0;
  w.rawBytes(challengeData);
  w.uint16LE(0);
  w.uint32LE(0);

  const r = new PacketReader(w.finish());
  const result = parseReconnectChallengeResponse(r);

  expect(result.status).toBe(0x00);
  expect(result.challengeData).toEqual(challengeData);
});

test("parseReconnectChallengeResponse returns error status", () => {
  const w = new PacketWriter();
  w.uint8(0x00);
  w.uint8(0x05);

  const r = new PacketReader(w.finish());
  const result = parseReconnectChallengeResponse(r);

  expect(result.status).toBe(0x05);
  expect(result.challengeData).toBeUndefined();
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/wow/protocol/auth.test.ts`
Expected: FAIL — `parseReconnectChallengeResponse` not exported

**Step 3: Implement parseReconnectChallengeResponse**

Add to `auth.ts` after `parseLogonChallengeResponse`:

```typescript
export interface ReconnectChallengeResult {
  status: number;
  challengeData?: Uint8Array;
}

export function parseReconnectChallengeResponse(
  r: PacketReader,
): ReconnectChallengeResult {
  r.skip(1);
  const status = r.uint8();
  if (status !== 0x00) {
    return { status };
  }
  const challengeData = r.bytes(16);
  r.skip(6);
  return { status, challengeData };
}
```

**Step 4: Run tests to verify they pass**

Run: `mise test src/wow/protocol/auth.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat: Add parseReconnectChallengeResponse
```

---

### Task 3: Reconnect proof builder — tests first

**Files:**
- Modify: `src/wow/protocol/auth.test.ts`
- Modify: `src/wow/protocol/auth.ts`

**Step 1: Write failing tests for buildReconnectProof**

Compute the expected MD5 offline. The test uses deterministic `clientData` injection.

Add to `auth.test.ts`:

```typescript
import { createHash } from "node:crypto";

test("buildReconnectProof produces correct packet with MD5 proof", () => {
  const account = "TEST";
  const challengeData = new Uint8Array(16).fill(0xaa);
  const testSessionKey = new Uint8Array(40).fill(0xbb);
  const clientData = new Uint8Array(16).fill(0xcc);

  const expectedProof = createHash("md5")
    .update(new TextEncoder().encode(account))
    .update(challengeData)
    .update(clientData)
    .update(testSessionKey)
    .digest();

  const pkt = buildReconnectProof(account, challengeData, testSessionKey, clientData);

  expect(pkt[0]).toBe(0x03);
  expect(pkt.slice(1, 17)).toEqual(clientData);
  expect(pkt.slice(17, 37)).toEqual(
    new Uint8Array([...expectedProof, 0, 0, 0, 0]),
  );
  expect(pkt.slice(37, 57)).toEqual(new Uint8Array(20));
  expect(pkt[57]).toBe(0x00);
  expect(pkt.byteLength).toBe(58);
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/wow/protocol/auth.test.ts`
Expected: FAIL — `buildReconnectProof` not exported

**Step 3: Implement buildReconnectProof**

Add to `auth.ts` after `parseReconnectChallengeResponse`. Add `createHash` to the existing `node:crypto` imports in `srp.ts`, or import directly in `auth.ts`:

```typescript
import { createHash, randomBytes } from "node:crypto";

export function buildReconnectProof(
  account: string,
  challengeData: Uint8Array,
  sessionKey: Uint8Array,
  clientData?: Uint8Array,
): Uint8Array {
  const cd = clientData ?? new Uint8Array(randomBytes(16));
  const proof = createHash("md5")
    .update(new TextEncoder().encode(account.toUpperCase()))
    .update(challengeData)
    .update(cd)
    .update(sessionKey)
    .digest();

  const w = new PacketWriter();
  w.uint8(AuthOpcode.RECONNECT_PROOF);
  w.rawBytes(cd);
  w.rawBytes(new Uint8Array(proof));
  w.rawBytes(new Uint8Array(4));
  w.rawBytes(new Uint8Array(20));
  w.uint8(0x00);
  return w.finish();
}
```

The proof is 16 bytes (MD5) but the field is 20 bytes, so 4 zero-pad bytes follow the digest.

**Step 4: Run tests to verify they pass**

Run: `mise test src/wow/protocol/auth.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `mise test`
Expected: PASS

**Step 6: Commit**

```
feat: Add buildReconnectProof with MD5 proof computation
```

---

### Task 4: Mock auth server reconnect mode

**Files:**
- Modify: `src/test/mock-auth-server.ts`
- Modify: `src/test/fixtures.ts`

**Step 1: Add reconnect fixtures**

Add to `fixtures.ts`:

```typescript
export const reconnectChallengeData = fromHex(
  "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf",
);
```

**Step 2: Add reconnect mode to mock auth server**

Extend `startMockAuthServer` opts with `reconnect?: { challengeData: Uint8Array; sessionKey: Uint8Array }`. When set:

- On `LOGON_CHALLENGE` (byte 0 = 0x00), respond with `RECONNECT_CHALLENGE` packet instead
- On `RECONNECT_PROOF` (byte 0 = 0x03), verify the MD5 proof, respond with success/failure
- Realm list handling stays the same

```typescript
function handleReconnectChallenge(
  socket: Socket,
  challengeData: Uint8Array,
) {
  const w = new PacketWriter();
  w.uint8(AuthOpcode.RECONNECT_CHALLENGE);
  w.uint8(0x00);
  w.rawBytes(challengeData);
  w.uint16LE(0);
  w.uint32LE(0);
  socket.write(w.finish());
}

function handleReconnectProof(
  socket: Socket,
  data: Uint8Array,
  challengeData: Uint8Array,
  expectedSessionKey: Uint8Array,
  account: string,
) {
  const clientData = data.slice(1, 17);
  const receivedProof = data.slice(17, 33);

  const expectedProof = createHash("md5")
    .update(new TextEncoder().encode(account))
    .update(challengeData)
    .update(clientData)
    .update(expectedSessionKey)
    .digest();

  const w = new PacketWriter();
  w.uint8(AuthOpcode.RECONNECT_PROOF);
  const match = Buffer.compare(
    Buffer.from(receivedProof),
    expectedProof,
  ) === 0;
  w.uint8(match ? 0x00 : 0x0b);
  socket.write(w.finish());
}
```

Update the `data` handler dispatch:

```typescript
data(socket: Socket, data: Uint8Array) {
  const opcode = data[0];
  if (opcode === AuthOpcode.LOGON_CHALLENGE) {
    if (opts.reconnect) {
      handleReconnectChallenge(socket, opts.reconnect.challengeData);
    } else {
      handleChallenge(socket);
    }
  } else if (opcode === AuthOpcode.LOGON_PROOF) {
    handleProof(socket, data);
  } else if (opcode === AuthOpcode.RECONNECT_PROOF) {
    handleReconnectProof(
      socket, data,
      opts.reconnect!.challengeData,
      opts.reconnect!.sessionKey,
      "TEST",
    );
  } else if (opcode === AuthOpcode.REALM_LIST) {
    handleRealmList(socket, opts.realmAddress);
  }
}
```

**Step 3: Run full test suite to verify nothing broke**

Run: `mise test`
Expected: PASS (mock server changes are additive)

**Step 4: Commit**

```
feat: Add reconnect mode to mock auth server
```

---

### Task 5: Auth state machine reconnect path + ReconnectRequiredError

**Files:**
- Modify: `src/wow/client.ts:49-59` (ClientConfig type)
- Modify: `src/wow/client.ts:165-267` (auth state machine)
- Modify: `src/wow/client.test.ts`

**Step 1: Write failing tests**

Add to `client.test.ts` in the `"auth error paths"` describe block:

```typescript
test("reconnect challenge succeeds with cached session key", async () => {
  const authServer = await startMockAuthServer({
    realmAddress: "127.0.0.1:1234",
    reconnect: {
      challengeData: reconnectChallengeData,
      sessionKey,
    },
  });

  try {
    const auth = await authHandshake({
      ...base,
      host: "127.0.0.1",
      port: authServer.port,
      cachedSessionKey: sessionKey,
    });

    expect(auth.sessionKey).toEqual(sessionKey);
    expect(auth.realmHost).toBe("127.0.0.1");
    expect(auth.realmPort).toBe(1234);
  } finally {
    authServer.stop();
  }
});

test("reconnect challenge without cached key throws ReconnectRequiredError", async () => {
  const authServer = await startMockAuthServer({
    realmAddress: "127.0.0.1:1234",
    reconnect: {
      challengeData: reconnectChallengeData,
      sessionKey,
    },
  });

  try {
    await expect(
      authHandshake({ ...base, host: "127.0.0.1", port: authServer.port }),
    ).rejects.toThrow(ReconnectRequiredError);
  } finally {
    authServer.stop();
  }
});
```

Add `reconnectChallengeData` to the imports from `test/fixtures` and `ReconnectRequiredError` to the imports from `wow/client`.

**Step 2: Run tests to verify they fail**

Run: `mise test src/wow/client.test.ts`
Expected: FAIL — `ReconnectRequiredError` not exported, `cachedSessionKey` not on type

**Step 3: Implement the reconnect path in client.ts**

Add `cachedSessionKey?: Uint8Array` to `ClientConfig`:

```typescript
export type ClientConfig = {
  host: string;
  port: number;
  account: string;
  password: string;
  character: string;
  srpPrivateKey?: bigint;
  clientSeed?: Uint8Array;
  pingIntervalMs?: number;
  language?: number;
  cachedSessionKey?: Uint8Array;
};
```

Export `ReconnectRequiredError`:

```typescript
export class ReconnectRequiredError extends Error {
  constructor() {
    super("Server requires reconnect but no cached session key is available");
    this.name = "ReconnectRequiredError";
  }
}
```

Add imports for the new auth functions:

```typescript
import {
  buildLogonChallenge,
  parseLogonChallengeResponse,
  buildLogonProof,
  parseLogonProofResponse,
  buildRealmListRequest,
  parseRealmList,
  parseReconnectChallengeResponse,
  buildReconnectProof,
} from "wow/protocol/auth";
```

Add a `handleReconnectChallenge` function near the other `handle*` functions:

```typescript
function handleReconnectChallenge(
  raw: Uint8Array,
  config: ClientConfig,
): Uint8Array {
  if (!config.cachedSessionKey) throw new ReconnectRequiredError();
  const r = new PacketReader(raw);
  r.skip(1);
  const result = parseReconnectChallengeResponse(r);
  if (result.status !== 0x00) {
    throw new Error(
      `Reconnect challenge failed: status 0x${result.status.toString(16)}`,
    );
  }
  return buildReconnectProof(
    config.account,
    result.challengeData!,
    config.cachedSessionKey,
  );
}
```

Modify the state machine in `authHandshake`:

```typescript
export function authHandshake(config: ClientConfig): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const buf = new AccumulatorBuffer();
    const srp = new SRP(config.account, config.password);
    let state: "challenge" | "proof" | "reconnect_proof" | "realms" = "challenge";
    let srpResult: SRPResult;
    let resolvedSessionKey: Uint8Array;
    let done = false;

    function fail(err: unknown, socket: Socket) {
      done = true;
      reject(err);
      socket.end();
    }

    Bun.connect({
      hostname: config.host,
      port: config.port,
      socket: {
        open(socket) {
          socket.write(buildLogonChallenge(config.account));
        },
        data(socket, data) {
          buf.append(new Uint8Array(data));

          try {
            const raw = buf.peek(buf.length);
            if (state === "challenge") {
              const opcode = raw[0];
              if (opcode === AuthOpcode.RECONNECT_CHALLENGE) {
                const proofPacket = handleReconnectChallenge(raw, config);
                buf.drain(buf.length);
                resolvedSessionKey = config.cachedSessionKey!;
                socket.write(proofPacket);
                state = "reconnect_proof";
              } else {
                srpResult = handleChallenge(raw, config, srp);
                buf.drain(buf.length);
                resolvedSessionKey = srpResult.K;
                socket.write(buildLogonProof(srpResult));
                state = "proof";
              }
            } else if (state === "proof") {
              handleProof(raw, srpResult);
              buf.drain(buf.length);
              socket.write(buildRealmListRequest());
              state = "realms";
            } else if (state === "reconnect_proof") {
              const r = new PacketReader(raw);
              r.skip(1);
              const status = r.uint8();
              if (status !== 0x00) {
                throw new Error(
                  `Reconnect proof failed: status 0x${status.toString(16)}`,
                );
              }
              buf.drain(buf.length);
              socket.write(buildRealmListRequest());
              state = "realms";
            } else if (state === "realms") {
              const { realmHost, realmPort, realmId } = handleRealms(raw);
              buf.drain(buf.length);
              done = true;
              socket.end();
              resolve({
                sessionKey: resolvedSessionKey,
                realmHost,
                realmPort,
                realmId,
              });
            }
          } catch (err) {
            if (err instanceof RangeError) return;
            fail(err, socket);
          }
        },
        close() {
          if (!done) reject(new Error("Auth connection closed"));
        },
      },
    }).catch(reject);
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `mise test src/wow/client.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `mise test`
Expected: PASS

**Step 6: Commit**

```
feat: Handle RECONNECT_CHALLENGE in auth state machine
```

---

### Task 6: authWithRetry wrapper — tests first

**Files:**
- Modify: `src/wow/client.ts`
- Modify: `src/wow/client.test.ts`

**Step 1: Write failing tests**

Add to `client.test.ts`:

```typescript
import { authWithRetry, ReconnectRequiredError } from "wow/client";

test("authWithRetry retries on ReconnectRequiredError then succeeds", async () => {
  let attempt = 0;
  const authServer = await startMockAuthServer({
    realmAddress: "127.0.0.1:1234",
  });

  const reconnectServer = await startMockAuthServer({
    realmAddress: "127.0.0.1:1234",
    reconnect: {
      challengeData: reconnectChallengeData,
      sessionKey,
    },
  });

  try {
    const auth = await authWithRetry(
      {
        ...base,
        host: "127.0.0.1",
        port: reconnectServer.port,
      },
      { maxAttempts: 3, baseDelayMs: 1 },
    );

    expect(auth.sessionKey).toEqual(sessionKey);
  } finally {
    authServer.stop();
    reconnectServer.stop();
  }
});

test("authWithRetry gives up after maxAttempts", async () => {
  const authServer = await startMockAuthServer({
    realmAddress: "127.0.0.1:1234",
    reconnect: {
      challengeData: reconnectChallengeData,
      sessionKey,
    },
  });

  try {
    await expect(
      authWithRetry(
        { ...base, host: "127.0.0.1", port: authServer.port },
        { maxAttempts: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow(ReconnectRequiredError);
  } finally {
    authServer.stop();
  }
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test src/wow/client.test.ts`
Expected: FAIL — `authWithRetry` not exported

**Step 3: Implement authWithRetry**

Add to `client.ts`:

```typescript
export async function authWithRetry(
  config: ClientConfig,
  opts?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<AuthResult> {
  const maxAttempts = opts?.maxAttempts ?? 5;
  const baseDelay = opts?.baseDelayMs ?? 5000;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await authHandshake(config);
    } catch (err) {
      if (!(err instanceof ReconnectRequiredError)) throw err;
      lastError = err;
      if (attempt + 1 < maxAttempts) {
        const delay = Math.min(baseDelay * 2 ** attempt, 60000);
        await Bun.sleep(delay);
      }
    }
  }
  throw lastError;
}
```

**Step 4: Run tests to verify they pass**

Run: `mise test src/wow/client.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `mise test`
Expected: PASS

**Step 6: Commit**

```
feat: Add authWithRetry with exponential backoff for reconnect
```

---

### Task 7: Wire callers to use authWithRetry

**Files:**
- Modify: `src/main.ts:19-30`
- Modify: `src/daemon/server.ts:147-152`

**Step 1: Update main.ts**

Change the import and call:

```typescript
const { authWithRetry, worldSession } = await import("wow/client");
```

```typescript
const auth = await authWithRetry(clientCfg);
```

**Step 2: Update daemon/server.ts**

Change the import at top of file:

```typescript
import { authWithRetry, authHandshake, worldSession, type AuthResult } from "wow/client";
```

Update `DaemonClient` type to accept either:

```typescript
type DaemonClient = {
  authHandshake: typeof authHandshake;
  worldSession: typeof worldSession;
};
```

Update `startDaemon`:

```typescript
const auth = await (client ? client.authHandshake(clientCfg) : authWithRetry(clientCfg));
```

This preserves the test injection seam (tests pass `authHandshake` directly) while production uses `authWithRetry`.

**Step 3: Run typecheck**

Run: `mise typecheck`
Expected: PASS

**Step 4: Run full test suite**

Run: `mise test`
Expected: PASS

**Step 5: Commit**

```
feat: Wire callers to use authWithRetry for reconnect resilience
```

---

### Task 8: Check the bug off in docs/bugs.md

**Files:**
- Modify: `docs/bugs.md:3`

**Step 1: Update the checkbox**

Change `- [ ]` to `- [x]` on line 3:

```markdown
- [x] No reconnect challenge/proof handling — quick reconnects fail
```

**Step 2: Commit**

```
docs: Mark reconnect challenge/proof bug as resolved
```

---

### Task 9: Final verification

**Step 1: Run full CI**

Run: `mise ci`
Expected: typecheck PASS, test PASS, format PASS

**Step 2: Fix any formatting issues**

Run: `mise format:fix` if formatting fails

**Step 3: Run live tests**

Run: `MISE_TASK_TIMEOUT=60s mise test:live`
Expected: PASS (reconnect path won't trigger against a clean live server, but the existing logon path must still work)
