# tuicraft 0.1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Authenticate with AzerothCore 3.3.5a via SRP-6, enter the world as a character, and stay connected via keepalive.

**Architecture:** Protocol-layer client using Bun.connect for TCP, node:crypto for SRP-6/Arc4, thin DataView wrappers for packet reading/writing, and Map-based opcode dispatch with an expect() pattern for request-response flows.

**Tech Stack:** Bun, TypeScript, node:crypto (SHA-1, HMAC-SHA1, RC4)

**Reference:** `../wow-chat-client` — TypeScript WoW 3.3.5a protocol implementation. Cross-reference for packet formats and SRP-6 math.

---

### Task 1: PacketReader and PacketWriter

**Files:**

- Create: `src/protocol/packet.ts`
- Create: `src/protocol/packet.test.ts`

**Step 1: Write the failing test**

```ts
// src/protocol/packet.test.ts
import { test, expect } from "bun:test";
import { PacketReader, PacketWriter } from "./packet";

test("PacketWriter writes and PacketReader reads uint8", () => {
  const w = new PacketWriter();
  w.uint8(0xff);
  const r = new PacketReader(w.finish());
  expect(r.uint8()).toBe(0xff);
});

test("PacketWriter writes and PacketReader reads uint16LE", () => {
  const w = new PacketWriter();
  w.uint16LE(0x1234);
  const r = new PacketReader(w.finish());
  expect(r.uint16LE()).toBe(0x1234);
});

test("PacketWriter writes and PacketReader reads uint16BE", () => {
  const w = new PacketWriter();
  w.uint16BE(0x1234);
  const r = new PacketReader(w.finish());
  expect(r.uint16BE()).toBe(0x1234);
});

test("PacketWriter writes and PacketReader reads uint32LE", () => {
  const w = new PacketWriter();
  w.uint32LE(0xdeadbeef);
  const r = new PacketReader(w.finish());
  expect(r.uint32LE()).toBe(0xdeadbeef);
});

test("PacketReader reads cString (null-terminated)", () => {
  const bytes = new Uint8Array([0x48, 0x69, 0x00]);
  const r = new PacketReader(bytes);
  expect(r.cString()).toBe("Hi");
});

test("PacketWriter writes cString with null terminator", () => {
  const w = new PacketWriter();
  w.cString("Hi");
  const data = w.finish();
  expect(data).toEqual(new Uint8Array([0x48, 0x69, 0x00]));
});

test("PacketReader reads bytes", () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const r = new PacketReader(bytes);
  expect(r.bytes(3)).toEqual(new Uint8Array([1, 2, 3]));
  expect(r.bytes(2)).toEqual(new Uint8Array([4, 5]));
});

test("PacketWriter writes bytes", () => {
  const w = new PacketWriter();
  w.rawBytes(new Uint8Array([0xaa, 0xbb]));
  w.uint8(0xcc);
  expect(w.finish()).toEqual(new Uint8Array([0xaa, 0xbb, 0xcc]));
});

test("PacketWriter grows buffer dynamically", () => {
  const w = new PacketWriter(2);
  w.uint32LE(1);
  w.uint32LE(2);
  w.uint32LE(3);
  const r = new PacketReader(w.finish());
  expect(r.uint32LE()).toBe(1);
  expect(r.uint32LE()).toBe(2);
  expect(r.uint32LE()).toBe(3);
});

test("PacketReader remaining returns unread bytes", () => {
  const r = new PacketReader(new Uint8Array(10));
  r.uint32LE();
  expect(r.remaining).toBe(6);
});

test("PacketReader floatLE round-trips", () => {
  const w = new PacketWriter();
  w.floatLE(3.14);
  const r = new PacketReader(w.finish());
  expect(r.floatLE()).toBeCloseTo(3.14, 2);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/protocol/packet.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```ts
// src/protocol/packet.ts
export class PacketReader {
  private view: DataView;
  private pos = 0;

  constructor(
    private data: Uint8Array,
    offset = 0,
  ) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.pos = offset;
  }

  get remaining() {
    return this.data.byteLength - this.pos;
  }

  get offset() {
    return this.pos;
  }

  uint8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  uint16LE(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  uint16BE(): number {
    const v = this.view.getUint16(this.pos, false);
    this.pos += 2;
    return v;
  }

  uint32LE(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  floatLE(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  bytes(n: number): Uint8Array {
    const slice = this.data.slice(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  cString(): string {
    let end = this.pos;
    while (end < this.data.byteLength && this.data[end] !== 0) end++;
    const str = new TextDecoder().decode(this.data.slice(this.pos, end));
    this.pos = end + 1;
    return str;
  }

  skip(n: number) {
    this.pos += n;
  }
}

export class PacketWriter {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;

  constructor(initialSize = 64) {
    this.buf = new Uint8Array(initialSize);
    this.view = new DataView(this.buf.buffer);
  }

  private grow(needed: number) {
    while (this.pos + needed > this.buf.byteLength) {
      const next = new Uint8Array(this.buf.byteLength * 2);
      next.set(this.buf);
      this.buf = next;
      this.view = new DataView(this.buf.buffer);
    }
  }

  get offset() {
    return this.pos;
  }

  uint8(v: number) {
    this.grow(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
  }

  uint16LE(v: number) {
    this.grow(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }

  uint16BE(v: number) {
    this.grow(2);
    this.view.setUint16(this.pos, v, false);
    this.pos += 2;
  }

  uint32LE(v: number) {
    this.grow(4);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
  }

  floatLE(v: number) {
    this.grow(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
  }

  rawBytes(data: Uint8Array) {
    this.grow(data.byteLength);
    this.buf.set(data, this.pos);
    this.pos += data.byteLength;
  }

  cString(s: string) {
    const encoded = new TextEncoder().encode(s);
    this.rawBytes(encoded);
    this.uint8(0);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/protocol/packet.test.ts`
Expected: All 11 tests PASS

**Step 5: Commit**

```bash
git add src/protocol/packet.ts src/protocol/packet.test.ts
git commit -m "feat: add PacketReader and PacketWriter"
```

---

### Task 2: Arc4 Encryption

**Files:**

- Create: `src/crypto/arc4.ts`
- Create: `src/crypto/arc4.test.ts`

**Step 1: Write the failing test**

```ts
// src/crypto/arc4.test.ts
import { test, expect } from "bun:test";
import { Arc4 } from "./arc4";

test("Arc4 encrypts and decrypts header bytes", () => {
  const sessionKey = new Uint8Array(40);
  for (let i = 0; i < 40; i++) sessionKey[i] = i;

  const arc4 = new Arc4(sessionKey);
  const header = new Uint8Array([0x00, 0x04, 0x95, 0x00]);
  const encrypted = arc4.encrypt(header);

  expect(encrypted).not.toEqual(header);
  expect(encrypted.byteLength).toBe(4);
});

test("Arc4 decrypt reverses encrypt with separate instance", () => {
  const sessionKey = new Uint8Array(40);
  for (let i = 0; i < 40; i++) sessionKey[i] = i;

  const sender = new Arc4(sessionKey);
  const receiver = new Arc4(sessionKey);

  const original = new Uint8Array([0x00, 0x08, 0xdc, 0x01, 0x00, 0x00]);
  const encrypted = sender.encrypt(new Uint8Array(original));
  const decrypted = receiver.decrypt(encrypted);

  expect(decrypted).toEqual(original);
});

test("Arc4 maintains cipher state across multiple calls", () => {
  const sessionKey = new Uint8Array(40).fill(0xab);

  const arc4a = new Arc4(sessionKey);
  const arc4b = new Arc4(sessionKey);

  const h1 = new Uint8Array([0x00, 0x04, 0x96, 0x00]);
  const h2 = new Uint8Array([0x00, 0x04, 0x96, 0x00]);

  const e1 = arc4a.encrypt(new Uint8Array(h1));
  const e2 = arc4a.encrypt(new Uint8Array(h2));

  expect(e1).not.toEqual(e2);

  const d1 = arc4b.decrypt(e1);
  const d2 = arc4b.decrypt(e2);
  expect(d1).toEqual(h1);
  expect(d2).toEqual(h2);
});

test("Arc4 uses HMAC-SHA1 key derivation", () => {
  const k1 = new Uint8Array(40).fill(0x00);
  const k2 = new Uint8Array(40).fill(0x01);

  const arc4a = new Arc4(k1);
  const arc4b = new Arc4(k2);

  const header = new Uint8Array([0x00, 0x04, 0x95, 0x00]);
  const e1 = arc4a.encrypt(new Uint8Array(header));
  const e2 = arc4b.encrypt(new Uint8Array(header));

  expect(e1).not.toEqual(e2);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/crypto/arc4.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```ts
// src/crypto/arc4.ts
import { createHmac, createCipheriv, createDecipheriv } from "node:crypto";
import type { Cipher, Decipher } from "node:crypto";

const ENCRYPT_KEY = "C2B3723CC6AED9B5343C53EE2F4367CE";
const DECRYPT_KEY = "CC98AE04E897EACA12DDC09342915357";

export class Arc4 {
  private encCipher: Cipher;
  private decCipher: Decipher;

  constructor(sessionKey: Uint8Array) {
    const encKey = createHmac("sha1", Buffer.from(ENCRYPT_KEY, "hex"))
      .update(sessionKey)
      .digest();
    const decKey = createHmac("sha1", Buffer.from(DECRYPT_KEY, "hex"))
      .update(sessionKey)
      .digest();

    this.encCipher = createCipheriv("rc4", encKey, "");
    this.decCipher = createDecipheriv("rc4", decKey, "");

    const drop = new Uint8Array(1024);
    this.encCipher.update(drop);
    this.decCipher.update(drop);
  }

  encrypt(data: Uint8Array): Uint8Array {
    return new Uint8Array(this.encCipher.update(data));
  }

  decrypt(data: Uint8Array): Uint8Array {
    return new Uint8Array(this.decCipher.update(data));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/crypto/arc4.test.ts`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add src/crypto/arc4.ts src/crypto/arc4.test.ts
git commit -m "feat: add Arc4 header encryption"
```

---

### Task 3: SRP-6 Authentication

**Files:**

- Create: `src/crypto/srp.ts`
- Create: `src/crypto/srp.test.ts`

This is the most complex piece. The SRP-6 implementation must match WoW 3.3.5a's variant exactly.

**Step 1: Write the failing test**

The test uses deterministic inputs so we can verify intermediate values. We fix the random value `a` by making it injectable.

```ts
// src/crypto/srp.test.ts
import { test, expect } from "bun:test";
import { SRP, bigIntToLeBytes, leBytesToBigInt, modPow } from "./srp";

test("bigIntToLeBytes converts correctly", () => {
  const n = BigInt("0x0102030405060708");
  const bytes = bigIntToLeBytes(n, 8);
  expect(bytes).toEqual(
    new Uint8Array([0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01]),
  );
});

test("leBytesToBigInt converts correctly", () => {
  const bytes = new Uint8Array([
    0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01,
  ]);
  expect(leBytesToBigInt(bytes)).toBe(BigInt("0x0102030405060708"));
});

test("bigIntToLeBytes and leBytesToBigInt round-trip", () => {
  const original = BigInt("0xdeadbeefcafe1234");
  const bytes = bigIntToLeBytes(original, 8);
  expect(leBytesToBigInt(bytes)).toBe(original);
});

test("modPow computes correctly", () => {
  expect(modPow(2n, 10n, 1000n)).toBe(24n);
  expect(modPow(3n, 7n, 50n)).toBe(37n);
});

test("SRP computes session key from known parameters", () => {
  const srp = new SRP("TEST", "PASSWORD");

  const g = 7n;
  const N = BigInt(
    "0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7",
  );

  const salt = new Uint8Array(32);
  for (let i = 0; i < 32; i++) salt[i] = i;

  const a = BigInt(
    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  );

  const result = srp.calculate(g, N, salt, BigInt("0x2"), a);

  expect(result.A.byteLength).toBe(32);
  expect(result.M1.byteLength).toBe(20);
  expect(result.K.byteLength).toBe(40);
});

test("SRP session key K is 40 bytes with interleaved hashing", () => {
  const srp = new SRP("ADMIN", "ADMIN");
  const g = 7n;
  const N = BigInt(
    "0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7",
  );
  const salt = new Uint8Array(32).fill(0xaa);
  const a = BigInt(
    "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  );

  const result = srp.calculate(g, N, salt, BigInt("0x3"), a);

  expect(result.K.byteLength).toBe(40);
  const allZero = result.K.every((b) => b === 0);
  expect(allZero).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/crypto/srp.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```ts
// src/crypto/srp.ts
import { createHash } from "node:crypto";

export function sha1(...buffers: Uint8Array[]): Uint8Array {
  const hash = createHash("sha1");
  for (const b of buffers) hash.update(b);
  return new Uint8Array(hash.digest());
}

export function leBytesToBigInt(bytes: Uint8Array): bigint {
  let hex = "";
  for (let i = bytes.length - 1; i >= 0; i--) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  if (hex.length === 0) return 0n;
  return BigInt("0x" + hex);
}

export function bigIntToLeBytes(n: bigint, size: number): Uint8Array {
  const result = new Uint8Array(size);
  let val = n;
  for (let i = 0; i < size; i++) {
    result[i] = Number(val & 0xffn);
    val >>= 8n;
  }
  return result;
}

function bigIntToBeBytes(n: bigint): Uint8Array {
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function padToLength(bytes: Uint8Array, len: number): Uint8Array {
  if (bytes.length >= len) return bytes;
  const padded = new Uint8Array(len);
  padded.set(bytes, len - bytes.length);
  return padded;
}

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

export interface SRPResult {
  K: Uint8Array;
  A: Uint8Array;
  M1: Uint8Array;
  M2: bigint;
}

export class SRP {
  constructor(
    private account: string,
    private password: string,
  ) {}

  calculate(
    g: bigint,
    N: bigint,
    saltBytes: Uint8Array,
    B: bigint,
    a?: bigint,
  ): SRPResult {
    const paddingLen = Math.ceil(N.toString(2).length / 8);

    const identityHash = sha1(
      new TextEncoder().encode(this.account + ":" + this.password),
    );

    const x = leBytesToBigInt(sha1(saltBytes, identityHash));

    if (!a) {
      const randomBytes = new Uint8Array(paddingLen);
      crypto.getRandomValues(randomBytes);
      a = leBytesToBigInt(randomBytes);
    }

    const A = modPow(g, a, N);
    const ALeBytes = bigIntToLeBytes(A, paddingLen);

    const u = leBytesToBigInt(
      sha1(
        padToLength(bigIntToBeBytes(leBytesToBigInt(ALeBytes)), paddingLen),
        padToLength(bigIntToBeBytes(B), paddingLen),
      ),
    );

    const k = 3n;
    const exp = u * x + a;
    const gxModN = modPow(g, x, N);
    const kgx = (k * gxModN) % N;
    const BInt = leBytesToBigInt(bigIntToLeBytes(B, paddingLen));
    const diff = (BInt + N - kgx) % N;
    const S = modPow(diff, exp, N);

    const SLeBytes = bigIntToLeBytes(
      leBytesToBigInt(bigIntToLeBytes(S, paddingLen)),
      paddingLen,
    );

    const S1: number[] = [];
    const S2: number[] = [];
    for (let i = 0; i < 16; i++) {
      S1.push(SLeBytes[i * 2]!);
      S2.push(SLeBytes[i * 2 + 1]!);
    }

    const S1h = sha1(new Uint8Array(S1));
    const S2h = sha1(new Uint8Array(S2));
    const K = new Uint8Array(40);
    for (let i = 0; i < 20; i++) {
      K[i * 2] = S1h[i]!;
      K[i * 2 + 1] = S2h[i]!;
    }

    const NLeBytes = bigIntToLeBytes(
      leBytesToBigInt(bigIntToLeBytes(N, paddingLen)),
      paddingLen,
    );
    const gLeBytes = bigIntToLeBytes(
      leBytesToBigInt(bigIntToLeBytes(g, paddingLen)),
      paddingLen,
    );
    const nHash = sha1(NLeBytes);
    const gHash = sha1(gLeBytes);
    const ngXor = new Uint8Array(20);
    for (let i = 0; i < 20; i++) {
      ngXor[i] = nHash[i]! ^ gHash[i]!;
    }

    const usernameHash = sha1(new TextEncoder().encode(this.account));

    const BLeBytes = bigIntToLeBytes(B, paddingLen);

    const M1 = sha1(ngXor, usernameHash, saltBytes, ALeBytes, BLeBytes, K);
    const M2 = leBytesToBigInt(sha1(ALeBytes, M1, K));

    return { K, A: ALeBytes, M1, M2 };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/crypto/srp.test.ts`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/crypto/srp.ts src/crypto/srp.test.ts
git commit -m "feat: add SRP-6 authentication"
```

---

### Task 4: Opcode Constants

**Files:**

- Create: `src/protocol/opcodes.ts`

No tests needed — this is just a constant enum.

**Step 1: Write the opcode enum**

```ts
// src/protocol/opcodes.ts
export const AuthOpcode = {
  LOGON_CHALLENGE: 0x00,
  LOGON_PROOF: 0x01,
  REALM_LIST: 0x10,
} as const;

export const ChallengeResult = {
  SUCCESS: 0x00,
  ACCOUNT_BANNED: 0x03,
  ACCOUNT_INVALID: 0x04,
  PASSWORD_INVALID: 0x05,
  ALREADY_ONLINE: 0x06,
  BUILD_INVALID: 0x09,
} as const;

export const GameOpcode = {
  CMSG_CHAR_ENUM: 0x0037,
  SMSG_CHAR_ENUM: 0x003b,
  CMSG_PLAYER_LOGIN: 0x003d,
  SMSG_LOGIN_VERIFY_WORLD: 0x0236,
  CMSG_PING: 0x01dc,
  SMSG_PONG: 0x01dd,
  SMSG_AUTH_CHALLENGE: 0x01ec,
  CMSG_AUTH_SESSION: 0x01ed,
  SMSG_AUTH_RESPONSE: 0x01ee,
  SMSG_TIME_SYNC_REQ: 0x0390,
  CMSG_TIME_SYNC_RESP: 0x0391,
} as const;
```

**Step 2: Commit**

```bash
git add src/protocol/opcodes.ts
git commit -m "feat: add opcode constants"
```

---

### Task 5: Auth Protocol (Realm Server)

**Files:**

- Create: `src/protocol/auth.ts`
- Create: `src/protocol/auth.test.ts`

This handles the authserver connection: LOGON_CHALLENGE, LOGON_PROOF, realm list.

**Step 1: Write the failing test**

```ts
// src/protocol/auth.test.ts
import { test, expect } from "bun:test";
import {
  buildLogonChallenge,
  parseLogonChallengeResponse,
  parseRealmList,
} from "./auth";
import { PacketReader } from "./packet";

test("buildLogonChallenge produces correct packet", () => {
  const packet = buildLogonChallenge("TEST");

  expect(packet[0]).toBe(0x00);
  expect(packet[1]).toBe(0x08);

  const accountBytes = packet.slice(packet.length - 4);
  expect(new TextDecoder().decode(accountBytes)).toBe("TEST");
});

test("buildLogonChallenge uppercases account", () => {
  const packet = buildLogonChallenge("test");

  const accountBytes = packet.slice(packet.length - 4);
  expect(new TextDecoder().decode(accountBytes)).toBe("TEST");
});

test("parseLogonChallengeResponse extracts SRP params on success", () => {
  const buf = new Uint8Array(119);
  const view = new DataView(buf.buffer);

  buf[0] = 0x00;
  buf[1] = 0x00;

  let offset = 2;
  for (let i = 0; i < 32; i++) buf[offset + i] = i + 1;
  offset += 32;

  buf[offset] = 1;
  offset += 1;
  buf[offset] = 7;
  offset += 1;

  buf[offset] = 32;
  offset += 1;
  for (let i = 0; i < 32; i++) buf[offset + i] = 0x80 + i;
  offset += 32;

  for (let i = 0; i < 32; i++) buf[offset + i] = 0x50 + i;
  offset += 32;

  for (let i = 0; i < 16; i++) buf[offset + i] = 0;
  offset += 16;

  buf[offset] = 0;
  offset += 1;

  const r = new PacketReader(buf);
  const result = parseLogonChallengeResponse(r);

  expect(result.status).toBe(0x00);
  expect(result.B).not.toBe(0n);
  expect(result.g).toBe(7n);
  expect(result.salt.byteLength).toBe(32);
});

test("parseLogonChallengeResponse returns error status", () => {
  const buf = new Uint8Array([0x00, 0x04]);
  const r = new PacketReader(buf);
  const result = parseLogonChallengeResponse(r);
  expect(result.status).toBe(0x04);
});

test("parseRealmList extracts realm info", () => {
  const w = makeRealmListPacket([
    {
      icon: 0,
      lock: 0,
      flags: 0,
      name: "Test",
      address: "127.0.0.1:8085",
      population: 1,
      characters: 2,
      timezone: 1,
      id: 1,
    },
  ]);
  const r = new PacketReader(w);
  const realms = parseRealmList(r);

  expect(realms.length).toBe(1);
  expect(realms[0]!.name).toBe("Test");
  expect(realms[0]!.host).toBe("127.0.0.1");
  expect(realms[0]!.port).toBe(8085);
  expect(realms[0]!.characters).toBe(2);
  expect(realms[0]!.id).toBe(1);
});

function makeRealmListPacket(
  realms: Array<{
    icon: number;
    lock: number;
    flags: number;
    name: string;
    address: string;
    population: number;
    characters: number;
    timezone: number;
    id: number;
  }>,
): Uint8Array {
  const parts: number[] = [];

  parts.push(0, 0);
  parts.push(0, 0, 0, 0);
  parts.push(realms.length & 0xff, (realms.length >> 8) & 0xff);

  for (const realm of realms) {
    parts.push(realm.icon);
    parts.push(realm.lock);
    parts.push(realm.flags);
    for (const ch of realm.name) parts.push(ch.charCodeAt(0));
    parts.push(0);
    for (const ch of realm.address) parts.push(ch.charCodeAt(0));
    parts.push(0);
    const popBuf = new ArrayBuffer(4);
    new DataView(popBuf).setUint32(0, realm.population, true);
    parts.push(...new Uint8Array(popBuf));
    parts.push(realm.characters);
    parts.push(realm.timezone);
    parts.push(realm.id);
  }

  return new Uint8Array(parts);
}
```

**Step 2: Run test to verify it fails**

Run: `bun test src/protocol/auth.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```ts
// src/protocol/auth.ts
import { PacketReader, PacketWriter } from "./packet";
import { AuthOpcode } from "./opcodes";
import {
  SRP,
  leBytesToBigInt,
  bigIntToLeBytes,
  type SRPResult,
} from "../crypto/srp";

const BUILD = 12340;
const GAME = "WoW";
const VERSION = [3, 3, 5] as const;
const PLATFORM = "x86";
const OS = "Win";
const LOCALE = "enUS";

export interface LogonChallengeResult {
  status: number;
  B: bigint;
  g: bigint;
  N: bigint;
  salt: Uint8Array;
}

export interface Realm {
  icon: number;
  lock: number;
  flags: number;
  name: string;
  host: string;
  port: number;
  population: number;
  characters: number;
  timezone: number;
  id: number;
}

function reverseString(s: string): string {
  return s.split("").reverse().join("");
}

export function buildLogonChallenge(account: string): Uint8Array {
  account = account.toUpperCase();
  const w = new PacketWriter();

  w.uint8(AuthOpcode.LOGON_CHALLENGE);
  w.uint8(0x08);
  w.uint16LE(30 + account.length);
  w.cString(reverseString(GAME));
  w.uint8(VERSION[0]);
  w.uint8(VERSION[1]);
  w.uint8(VERSION[2]);
  w.uint16LE(BUILD);
  w.cString(reverseString(PLATFORM));
  w.cString(reverseString(OS));
  w.cString(reverseString(LOCALE));
  w.uint8(0);
  w.uint8(0);
  w.uint8(0);
  w.uint8(127);
  w.uint8(0);
  w.uint8(0);
  w.uint8(1);
  w.uint8(account.length);
  w.rawBytes(new TextEncoder().encode(account));

  return w.finish();
}

export function parseLogonChallengeResponse(
  r: PacketReader,
): LogonChallengeResult {
  r.uint8();
  const status = r.uint8();

  if (status !== 0x00) {
    return { status, B: 0n, g: 0n, N: 0n, salt: new Uint8Array(0) };
  }

  const BBytes = r.bytes(32);
  const B = leBytesToBigInt(BBytes);

  const gLen = r.uint8();
  const gBytes = r.bytes(gLen);
  const g = leBytesToBigInt(gBytes);

  const NLen = r.uint8();
  const NBytes = r.bytes(NLen);
  const N = leBytesToBigInt(NBytes);

  const salt = r.bytes(32);

  r.skip(16);
  r.uint8();

  return { status, B, g, N, salt };
}

export function buildLogonProof(srpResult: SRPResult): Uint8Array {
  const w = new PacketWriter();
  w.uint8(AuthOpcode.LOGON_PROOF);
  w.rawBytes(srpResult.A);
  w.rawBytes(srpResult.M1);
  w.rawBytes(new Uint8Array(20));
  w.uint8(0x00);
  w.uint8(0x00);
  return w.finish();
}

export function parseLogonProofResponse(r: PacketReader): {
  status: number;
  M2: bigint;
} {
  const status = r.uint8();
  if (status !== 0x00) return { status, M2: 0n };
  const M2Bytes = r.bytes(20);
  const M2 = leBytesToBigInt(M2Bytes);
  return { status, M2 };
}

export function buildRealmListRequest(): Uint8Array {
  const w = new PacketWriter();
  w.uint8(AuthOpcode.REALM_LIST);
  w.uint32LE(0x00);
  return w.finish();
}

export function parseRealmList(r: PacketReader): Realm[] {
  r.uint16LE();
  r.uint32LE();
  const count = r.uint16LE();

  const realms: Realm[] = [];
  for (let i = 0; i < count; i++) {
    const icon = r.uint8();
    const lock = r.uint8();
    const flags = r.uint8();
    const name = r.cString();
    const address = r.cString();
    const [host = "", portStr = "8085"] = address.split(":");
    const port = parseInt(portStr, 10);
    const population = r.uint32LE();
    const characters = r.uint8();
    const timezone = r.uint8();
    const id = r.uint8();

    if (flags & 0x04) {
      r.skip(3);
      r.uint8();
    }

    realms.push({
      icon,
      lock,
      flags,
      name,
      host,
      port,
      population,
      characters,
      timezone,
      id,
    });
  }

  return realms;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/protocol/auth.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/protocol/auth.ts src/protocol/auth.test.ts
git commit -m "feat: add auth protocol (challenge, proof, realm list)"
```

---

### Task 6: World Protocol

**Files:**

- Create: `src/protocol/world.ts`
- Create: `src/protocol/world.test.ts`

Handles: world auth proof, Arc4 enable, packet framing (encrypt/decrypt headers), TCP buffering, opcode dispatch with `expect()`, character list parsing, keepalive handlers.

**Step 1: Write the failing test**

```ts
// src/protocol/world.test.ts
import { test, expect } from "bun:test";
import {
  buildWorldAuthPacket,
  parseCharacterList,
  OpcodeDispatch,
  AccumulatorBuffer,
  INCOMING_HEADER_SIZE,
} from "./world";
import { PacketReader, PacketWriter } from "./packet";
import { GameOpcode } from "./opcodes";

test("buildWorldAuthPacket produces valid packet", async () => {
  const sessionKey = new Uint8Array(40).fill(0xab);
  const serverSeed = new Uint8Array([1, 2, 3, 4]);
  const packet = await buildWorldAuthPacket("TEST", sessionKey, serverSeed, 1);

  expect(packet.byteLength).toBeGreaterThan(6);
});

test("parseCharacterList extracts character names and GUIDs", () => {
  const w = new PacketWriter();
  w.uint8(1);

  for (let i = 0; i < 8; i++) w.uint8(i + 1);
  w.cString("TestChar");
  w.uint8(1);
  w.uint8(1);
  w.uint8(0);
  w.uint32LE(0);
  w.uint8(0);
  w.uint8(80);
  w.uint32LE(1);
  w.uint32LE(0);
  w.floatLE(0);
  w.floatLE(0);
  w.floatLE(0);
  w.uint32LE(0);
  w.uint32LE(0);
  w.uint32LE(0);
  w.uint8(0);
  w.uint32LE(0);
  w.uint32LE(0);
  w.uint32LE(0);
  for (let j = 0; j < 23; j++) {
    w.uint32LE(0);
    w.uint8(0);
    w.uint32LE(0);
  }

  const r = new PacketReader(w.finish());
  const chars = parseCharacterList(r);

  expect(chars.length).toBe(1);
  expect(chars[0]!.name).toBe("TestChar");
  expect(chars[0]!.level).toBe(80);
});

test("OpcodeDispatch persistent handler fires on matching opcode", () => {
  const dispatch = new OpcodeDispatch();
  let received = false;

  dispatch.on(0x1234, () => {
    received = true;
  });
  dispatch.handle(0x1234, new PacketReader(new Uint8Array(0)));

  expect(received).toBe(true);
});

test("OpcodeDispatch expect resolves on matching opcode", async () => {
  const dispatch = new OpcodeDispatch();

  const promise = dispatch.expect(0x5678);
  dispatch.handle(0x5678, new PacketReader(new Uint8Array([0x42])));

  const reader = await promise;
  expect(reader.uint8()).toBe(0x42);
});

test("OpcodeDispatch expect takes priority over persistent handler", async () => {
  const dispatch = new OpcodeDispatch();
  let persistentCalled = false;

  dispatch.on(0x1111, () => {
    persistentCalled = true;
  });
  const promise = dispatch.expect(0x1111);
  dispatch.handle(0x1111, new PacketReader(new Uint8Array(0)));

  await promise;
  expect(persistentCalled).toBe(false);
});

test("AccumulatorBuffer accumulates and drains", () => {
  const acc = new AccumulatorBuffer();
  acc.append(new Uint8Array([1, 2, 3]));
  acc.append(new Uint8Array([4, 5]));

  expect(acc.length).toBe(5);

  const chunk = acc.drain(3);
  expect(chunk).toEqual(new Uint8Array([1, 2, 3]));
  expect(acc.length).toBe(2);
});

test("AccumulatorBuffer peek does not consume", () => {
  const acc = new AccumulatorBuffer();
  acc.append(new Uint8Array([0xaa, 0xbb, 0xcc]));

  const peeked = acc.peek(2);
  expect(peeked).toEqual(new Uint8Array([0xaa, 0xbb]));
  expect(acc.length).toBe(3);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/protocol/world.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```ts
// src/protocol/world.ts
import { createHash, randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { PacketReader, PacketWriter } from "./packet";
import { GameOpcode } from "./opcodes";
import { Arc4 } from "../crypto/arc4";

export const INCOMING_HEADER_SIZE = 4;
export const OUTGOING_HEADER_SIZE = 6;
const INCOMING_OPCODE_SIZE = 2;
const OUTGOING_OPCODE_SIZE = 4;

const BUILD = 12340;

interface AddonEntry {
  name: string;
  flags: number;
  modulusCrc: number;
  urlCrc: number;
}

const ADDONS: AddonEntry[] = [
  { name: "Blizzard_AchievementUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_ArenaUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_AuctionUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_BarbershopUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_BattlefieldMinimap", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_BindingUI", flags: 225, modulusCrc: 1276933997, urlCrc: 0 },
  { name: "Blizzard_Calendar", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_CombatLog", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_CombatText", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_DebugTools", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_GlyphUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_GMChatUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_GMSurveyUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_GuildBankUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_InspectUI", flags: 92, modulusCrc: 1276933997, urlCrc: 0 },
  { name: "Blizzard_ItemSocketingUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_MacroUI", flags: 31, modulusCrc: 1276933997, urlCrc: 0 },
  { name: "Blizzard_RaidUI", flags: 201, modulusCrc: 1276933997, urlCrc: 0 },
  { name: "Blizzard_TalentUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_TimeManager", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_TokenUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_TradeSkillUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_TrainerUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
];

function compressAddonInfo(): Uint8Array {
  const parts: number[] = [ADDONS.length, 0, 0, 0];
  for (const addon of ADDONS) {
    for (let i = 0; i < addon.name.length; i++)
      parts.push(addon.name.charCodeAt(i));
    parts.push(0);
    parts.push(addon.flags);
    const crcBuf = new ArrayBuffer(4);
    const crcView = new DataView(crcBuf);
    crcView.setUint32(0, addon.modulusCrc, true);
    parts.push(...new Uint8Array(crcBuf));
    crcView.setUint32(0, addon.urlCrc, true);
    parts.push(...new Uint8Array(crcBuf));
  }
  const timeBuf = new ArrayBuffer(4);
  new DataView(timeBuf).setUint32(0, 1636457673, true);
  parts.push(...new Uint8Array(timeBuf));
  return new Uint8Array(deflateSync(new Uint8Array(parts), { level: 9 }));
}

export async function buildWorldAuthPacket(
  account: string,
  sessionKey: Uint8Array,
  serverSeed: Uint8Array,
  realmId: number,
): Promise<Uint8Array> {
  account = account.toUpperCase();
  const clientSeed = randomBytes(4);

  const hash = createHash("sha1");
  hash.update(account);
  hash.update(new Uint8Array(4));
  hash.update(clientSeed);
  hash.update(serverSeed);
  hash.update(sessionKey);
  const digest = new Uint8Array(hash.digest());

  const addonInfo = compressAddonInfo();

  const w = new PacketWriter();
  w.uint32LE(BUILD);
  w.uint32LE(0);
  w.cString(account);
  w.uint32LE(0);
  w.rawBytes(clientSeed);
  w.uint32LE(0);
  w.uint32LE(0);
  w.uint32LE(realmId);
  w.uint32LE(2);
  w.uint32LE(0);
  w.rawBytes(digest);
  w.rawBytes(addonInfo);

  return w.finish();
}

export interface CharacterInfo {
  guidLow: number;
  guidHigh: number;
  name: string;
  race: number;
  classId: number;
  gender: number;
  level: number;
  zone: number;
  map: number;
}

export function parseCharacterList(r: PacketReader): CharacterInfo[] {
  const count = r.uint8();
  const chars: CharacterInfo[] = [];

  for (let i = 0; i < count; i++) {
    const guidLow = r.uint32LE();
    const guidHigh = r.uint32LE();
    const name = r.cString();
    const race = r.uint8();
    const classId = r.uint8();
    const gender = r.uint8();
    r.uint32LE();
    r.uint8();
    const level = r.uint8();
    const zone = r.uint32LE();
    const map = r.uint32LE();
    r.floatLE();
    r.floatLE();
    r.floatLE();
    r.uint32LE();
    r.uint32LE();
    r.uint32LE();
    r.uint8();
    r.uint32LE();
    r.uint32LE();
    r.uint32LE();
    for (let j = 0; j < 23; j++) {
      r.uint32LE();
      r.uint8();
      r.uint32LE();
    }

    chars.push({
      guidLow,
      guidHigh,
      name,
      race,
      classId,
      gender,
      level,
      zone,
      map,
    });
  }

  return chars;
}

type OpcodeHandler = (reader: PacketReader) => void;

export class OpcodeDispatch {
  private handlers = new Map<number, OpcodeHandler>();
  private pending = new Map<number, (reader: PacketReader) => void>();

  on(opcode: number, handler: OpcodeHandler) {
    this.handlers.set(opcode, handler);
  }

  expect(opcode: number): Promise<PacketReader> {
    return new Promise((resolve) => {
      this.pending.set(opcode, resolve);
    });
  }

  handle(opcode: number, reader: PacketReader) {
    const pendingResolve = this.pending.get(opcode);
    if (pendingResolve) {
      this.pending.delete(opcode);
      pendingResolve(reader);
      return;
    }
    const handler = this.handlers.get(opcode);
    if (handler) handler(reader);
  }
}

export class AccumulatorBuffer {
  private buf = new Uint8Array(0);

  get length() {
    return this.buf.byteLength;
  }

  append(data: Uint8Array) {
    const next = new Uint8Array(this.buf.byteLength + data.byteLength);
    next.set(this.buf);
    next.set(data, this.buf.byteLength);
    this.buf = next;
  }

  peek(n: number): Uint8Array {
    return this.buf.slice(0, n);
  }

  drain(n: number): Uint8Array {
    const chunk = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return chunk;
  }
}

export function buildOutgoingPacket(
  opcode: number,
  body: Uint8Array,
  arc4?: Arc4,
): Uint8Array {
  const size = body.byteLength + OUTGOING_OPCODE_SIZE;
  const header = new Uint8Array(OUTGOING_HEADER_SIZE);
  const hView = new DataView(header.buffer);
  hView.setUint16(0, size, false);
  hView.setUint32(2, opcode, true);

  if (arc4) {
    const encrypted = arc4.encrypt(header);
    const packet = new Uint8Array(OUTGOING_HEADER_SIZE + body.byteLength);
    packet.set(encrypted);
    packet.set(body, OUTGOING_HEADER_SIZE);
    return packet;
  }

  const packet = new Uint8Array(OUTGOING_HEADER_SIZE + body.byteLength);
  packet.set(header);
  packet.set(body, OUTGOING_HEADER_SIZE);
  return packet;
}

export function decryptIncomingHeader(
  header: Uint8Array,
  arc4?: Arc4,
): { size: number; opcode: number } {
  const decrypted = arc4 ? arc4.decrypt(header) : header;
  const view = new DataView(
    decrypted.buffer,
    decrypted.byteOffset,
    decrypted.byteLength,
  );
  const size = view.getUint16(0, false);
  const opcode = view.getUint16(2, true);
  return { size, opcode };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/protocol/world.test.ts`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add src/protocol/world.ts src/protocol/world.test.ts
git commit -m "feat: add world protocol (auth, dispatch, buffering, character list)"
```

---

### Task 7: CLI Entry Point and Integration

**Files:**

- Create: `src/index.ts`

This orchestrates the full flow: parse args → auth handshake → world login → keepalive loop. No unit test for this — it's validated by integration testing against the live server.

**Step 1: Write the entry point**

```ts
// src/index.ts
import { parseArgs } from "node:util";
import { PacketReader, PacketWriter } from "./protocol/packet";
import { AuthOpcode, GameOpcode } from "./protocol/opcodes";
import { SRP, leBytesToBigInt } from "./crypto/srp";
import { Arc4 } from "./crypto/arc4";
import {
  buildLogonChallenge,
  parseLogonChallengeResponse,
  buildLogonProof,
  parseLogonProofResponse,
  buildRealmListRequest,
  parseRealmList,
} from "./protocol/auth";
import {
  buildWorldAuthPacket,
  parseCharacterList,
  OpcodeDispatch,
  AccumulatorBuffer,
  INCOMING_HEADER_SIZE,
  buildOutgoingPacket,
  decryptIncomingHeader,
} from "./protocol/world";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    host: { type: "string", default: "t1" },
    port: { type: "string", default: "3724" },
    account: { type: "string" },
    password: { type: "string" },
    character: { type: "string" },
  },
});

if (!values.account || !values.password || !values.character) {
  console.error(
    "Usage: bun src/index.ts --account <account> --password <password> --character <name>",
  );
  process.exit(1);
}

const ACCOUNT = values.account.toUpperCase();
const PASSWORD = values.password.toUpperCase();
const CHARACTER = values.character;
const HOST = values.host!;
const AUTH_PORT = parseInt(values.port!, 10);

async function authHandshake(): Promise<{
  sessionKey: Uint8Array;
  realmHost: string;
  realmPort: number;
  realmId: number;
}> {
  return new Promise((resolve, reject) => {
    const acc = new AccumulatorBuffer();

    let state: "challenge" | "proof" | "realms" = "challenge";
    let srpResult: ReturnType<SRP["calculate"]>;

    const socket = Bun.connect({
      hostname: HOST,
      port: AUTH_PORT,
      socket: {
        open(socket) {
          console.log("Connected to authserver");
          socket.write(buildLogonChallenge(ACCOUNT));
        },
        data(socket, data) {
          acc.append(new Uint8Array(data));

          if (state === "challenge") {
            if (acc.length < 3) return;
            const buf = acc.drain(acc.length);
            const r = new PacketReader(buf);
            const challenge = parseLogonChallengeResponse(r);

            if (challenge.status !== 0x00) {
              reject(
                new Error(
                  `Auth challenge failed: status 0x${challenge.status.toString(16)}`,
                ),
              );
              socket.end();
              return;
            }

            console.log("SRP-6 challenge received, computing proof...");
            const srp = new SRP(ACCOUNT, PASSWORD);
            srpResult = srp.calculate(
              challenge.g,
              challenge.N,
              challenge.salt,
              challenge.B,
            );

            socket.write(buildLogonProof(srpResult));
            state = "proof";
          } else if (state === "proof") {
            if (acc.length < 2) return;
            const buf = acc.drain(acc.length);
            const r = new PacketReader(buf);
            const proof = parseLogonProofResponse(r);

            if (proof.status !== 0x00) {
              reject(
                new Error(
                  `Auth proof failed: status 0x${proof.status.toString(16)}`,
                ),
              );
              socket.end();
              return;
            }

            if (proof.M2 !== srpResult.M2) {
              reject(new Error("Server proof M2 mismatch"));
              socket.end();
              return;
            }

            console.log("Authenticated. Requesting realm list...");
            socket.write(buildRealmListRequest());
            state = "realms";
          } else if (state === "realms") {
            if (acc.length < 3) return;
            const buf = acc.drain(acc.length);
            const r = new PacketReader(buf);
            r.uint8();
            const realms = parseRealmList(r);

            if (realms.length === 0) {
              reject(new Error("No realms available"));
              socket.end();
              return;
            }

            const realm = realms[0]!;
            console.log(`Realm: ${realm.name} (${realm.host}:${realm.port})`);
            socket.end();
            resolve({
              sessionKey: srpResult.K,
              realmHost: realm.host,
              realmPort: realm.port,
              realmId: realm.id,
            });
          }
        },
        error(_socket, err) {
          reject(err);
        },
        close() {},
      },
    });
  });
}

async function worldSession(
  sessionKey: Uint8Array,
  realmHost: string,
  realmPort: number,
  realmId: number,
) {
  const dispatch = new OpcodeDispatch();
  const connectionTime = Date.now();
  let arc4: Arc4 | undefined;
  let worldSocket: ReturnType<typeof Bun.connect> extends Promise<infer T>
    ? T
    : never;

  dispatch.on(GameOpcode.SMSG_TIME_SYNC_REQ, (r) => {
    const counter = r.uint32LE();
    const elapsed = Date.now() - connectionTime;
    const w = new PacketWriter();
    w.uint32LE(counter);
    w.uint32LE(elapsed);
    worldSocket.write(
      buildOutgoingPacket(GameOpcode.CMSG_TIME_SYNC_RESP, w.finish(), arc4),
    );
  });

  dispatch.on(GameOpcode.SMSG_PONG, () => {});

  return new Promise<void>((resolve, reject) => {
    const acc = new AccumulatorBuffer();
    let headerPending = true;
    let currentSize = 0;
    let currentOpcode = 0;

    function processBuffer() {
      while (true) {
        if (headerPending) {
          if (acc.length < INCOMING_HEADER_SIZE) return;
          const headerBytes = acc.drain(INCOMING_HEADER_SIZE);
          const { size, opcode } = decryptIncomingHeader(headerBytes, arc4);
          currentSize = size;
          currentOpcode = opcode;
          headerPending = false;
        }

        const bodySize = currentSize - 2;
        if (bodySize > 0 && acc.length < bodySize) return;

        const body = bodySize > 0 ? acc.drain(bodySize) : new Uint8Array(0);
        const reader = new PacketReader(body);
        dispatch.handle(currentOpcode, reader);
        headerPending = true;
      }
    }

    Bun.connect({
      hostname: realmHost,
      port: realmPort,
      socket: {
        async open(socket) {
          worldSocket = socket;
          console.log("Connected to worldserver");
        },
        data(socket, data) {
          acc.append(new Uint8Array(data));
          processBuffer();
        },
        error(_socket, err) {
          reject(err);
        },
        close() {
          console.log("Disconnected from worldserver");
          resolve();
        },
      },
    }).then(async (socket) => {
      worldSocket = socket;

      const challengeReader = await dispatch.expect(
        GameOpcode.SMSG_AUTH_CHALLENGE,
      );
      challengeReader.uint32LE();
      const serverSeed = challengeReader.bytes(4);

      console.log("World auth challenge received, sending proof...");
      const authBody = await buildWorldAuthPacket(
        ACCOUNT,
        sessionKey,
        serverSeed,
        realmId,
      );
      socket.write(buildOutgoingPacket(GameOpcode.CMSG_AUTH_SESSION, authBody));

      arc4 = new Arc4(sessionKey);

      const authResponse = await dispatch.expect(GameOpcode.SMSG_AUTH_RESPONSE);
      const authResult = authResponse.uint8();
      if (authResult !== 0x0c) {
        reject(new Error(`World auth failed: 0x${authResult.toString(16)}`));
        socket.end();
        return;
      }

      console.log("World auth succeeded. Requesting character list...");
      const enumBody = new Uint8Array(0);
      socket.write(
        buildOutgoingPacket(GameOpcode.CMSG_CHAR_ENUM, enumBody, arc4),
      );

      const charReader = await dispatch.expect(GameOpcode.SMSG_CHAR_ENUM);
      const characters = parseCharacterList(charReader);
      console.log(
        `Characters: ${characters.map((c) => `${c.name} (Lv${c.level})`).join(", ")}`,
      );

      const char = characters.find((c) => c.name === CHARACTER);
      if (!char) {
        reject(new Error(`Character "${CHARACTER}" not found`));
        socket.end();
        return;
      }

      console.log(`Logging in as ${char.name}...`);
      const loginW = new PacketWriter();
      loginW.uint32LE(char.guidLow);
      loginW.uint32LE(char.guidHigh);
      socket.write(
        buildOutgoingPacket(
          GameOpcode.CMSG_PLAYER_LOGIN,
          loginW.finish(),
          arc4,
        ),
      );

      await dispatch.expect(GameOpcode.SMSG_LOGIN_VERIFY_WORLD);
      console.log(`${char.name} logged in.`);

      let pingCount = 1;
      setInterval(() => {
        const w = new PacketWriter();
        w.uint32LE(pingCount++);
        w.uint32LE(Math.floor(Math.random() * 20) + 20);
        socket.write(
          buildOutgoingPacket(GameOpcode.CMSG_PING, w.finish(), arc4),
        );
      }, 30000);
    });
  });
}

async function main() {
  try {
    console.log(`Connecting to ${HOST}:${AUTH_PORT}...`);
    const { sessionKey, realmHost, realmPort, realmId } = await authHandshake();
    await worldSession(sessionKey, realmHost, realmPort, realmId);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();
```

**Step 2: Integration test against live server**

Run: `bun src/index.ts --account XI --password <password> --character Xi`

Expected output:

```
Connecting to t1:3724...
Connected to authserver
SRP-6 challenge received, computing proof...
Authenticated. Requesting realm list...
Realm: AzerothCore (t1:8085)
Connected to worldserver
World auth challenge received, sending proof...
World auth succeeded. Requesting character list...
Characters: Xi (Lv80)
Logging in as Xi...
Xi logged in.
```

The process should stay alive responding to TIME_SYNC_REQ and sending PINGs.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add CLI entry point with full auth → world → keepalive flow"
```

---

### Task 8: Integration Testing and Bug Fixes

After the integration test against the live server, there will likely be protocol bugs to fix. Common issues:

- **Byte ordering**: BigInt ↔ little-endian conversion off-by-one. Compare intermediate SRP values against the reference.
- **Auth response code**: The success code for SMSG_AUTH_RESPONSE may be `0x0c` (AUTH_OK) not `0x00`. Check against the server's actual response.
- **Packet size calculation**: The `size` field in the incoming header includes the opcode bytes (2) but not the size bytes themselves. Ensure `bodySize = size - 2`.
- **Realm address parsing**: The realm address comes as `"host:port"` string. Ensure port parsing handles edge cases.
- **SMSG_AUTH_CHALLENGE format**: The first field is a `uint32` (value 1), followed by the 4-byte server seed, then possibly more seeds. The reference only reads the first 4-byte seed.

**Step 1: Run against live server, observe failures**

Run: `bun src/index.ts --account XI --password <password> --character Xi`

**Step 2: Debug and fix any protocol issues**

Cross-reference `../wow-chat-client` for correct packet formats. Add debug logging temporarily if needed.

**Step 3: Run all unit tests to verify no regressions**

Run: `bun test`
Expected: All tests PASS

**Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix: protocol corrections from integration testing"
```
