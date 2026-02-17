import { createHash, randomBytes } from "node:crypto"

export interface SRPResult {
  K: Uint8Array
  A: Uint8Array
  M1: Uint8Array
  M2: bigint
}

export function sha1(...buffers: Uint8Array[]): Uint8Array {
  const hash = createHash("sha1")
  for (const buf of buffers) hash.update(buf)
  return new Uint8Array(hash.digest())
}

export function leBytesToBigInt(bytes: Uint8Array): bigint {
  const hex: string[] = []
  for (let i = bytes.length - 1; i >= 0; i--) {
    hex.push(bytes[i].toString(16).padStart(2, "0"))
  }
  if (hex.length === 0) return 0n
  return BigInt("0x" + hex.join(""))
}

export function bigIntToLeBytes(n: bigint, size: number): Uint8Array {
  const result = new Uint8Array(size)
  let remaining = n
  for (let i = 0; i < size; i++) {
    result[i] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return result
}

function bigIntToBeBytes(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array([0])
  let hex = n.toString(16)
  if (hex.length % 2 !== 0) hex = "0" + hex
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function beBytesToBigInt(bytes: Uint8Array): bigint {
  const hex: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    hex.push(bytes[i].toString(16).padStart(2, "0"))
  }
  if (hex.length === 0) return 0n
  return BigInt("0x" + hex.join(""))
}

function beReverse(n: bigint): bigint {
  const be = bigIntToBeBytes(n)
  const reversed = new Uint8Array(be.length)
  for (let i = 0; i < be.length; i++) reversed[i] = be[be.length - 1 - i]
  return beBytesToBigInt(reversed)
}

function padTo(buf: Uint8Array, len: number): Uint8Array {
  if (buf.length >= len) return buf
  const padded = new Uint8Array(len)
  padded.set(buf, len - buf.length)
  return padded
}

function hashPadded(padLen: number, ...buffers: Uint8Array[]): Uint8Array {
  return sha1(...buffers.map(b => padTo(b, padLen)))
}

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  base = base % mod
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod
      exp -= 1n
    } else {
      base = (base * base) % mod
      exp /= 2n
    }
  }
  return result
}

export class SRP {
  private account: string
  private password: string

  constructor(account: string, password: string) {
    this.account = account.toUpperCase()
    this.password = password.toUpperCase()
  }

  calculate(g: bigint, N: bigint, saltBytes: Uint8Array, B: bigint, a?: bigint): SRPResult {
    const nBits = N.toString(2).length
    const padLen = Math.trunc((nBits + 7) / 8)

    if (a === undefined) {
      a = leBytesToBigInt(new Uint8Array(randomBytes(padLen)))
    }

    const packetSalt = beBytesToBigInt(saltBytes)
    const packetB = beBytesToBigInt(bigIntToLeBytes(B, padLen))

    const identityHash = sha1(new TextEncoder().encode(this.account + ":" + this.password))
    const x = leBytesToBigInt(sha1(bigIntToBeBytes(packetSalt), identityHash))

    const A = modPow(g, a, N)
    const A_REV_INT = beReverse(A)
    const B_REV_INT = beReverse(packetB)

    const A_REV = bigIntToBeBytes(A_REV_INT)

    const uHash = hashPadded(padLen, A_REV, bigIntToBeBytes(packetB))
    const u = leBytesToBigInt(uHash)

    const exp = u * x + a
    const kgx = (modPow(g, x, N) * 3n) % N
    const S_INT = modPow(B_REV_INT + N - kgx, exp, N)

    const S_bytes = bigIntToBeBytes(beReverse(S_INT))
    const S1 = new Uint8Array(16)
    const S2 = new Uint8Array(16)
    for (let i = 0; i < 16; i++) {
      S1[i] = S_bytes[i * 2]
      S2[i] = S_bytes[i * 2 + 1]
    }

    const S1h = sha1(S1)
    const S2h = sha1(S2)
    const K = new Uint8Array(40)
    for (let i = 0; i < 20; i++) {
      K[i * 2] = S1h[i]
      K[i * 2 + 1] = S2h[i]
    }

    const nHash = sha1(bigIntToBeBytes(beReverse(N)))
    const gHash = sha1(bigIntToBeBytes(beReverse(g)))
    const NgXor = new Uint8Array(20)
    for (let i = 0; i < 20; i++) {
      NgXor[i] = nHash[i] ^ gHash[i]
    }

    const usernameHash = sha1(new TextEncoder().encode(this.account))

    const M1 = sha1(
      NgXor,
      usernameHash,
      bigIntToBeBytes(packetSalt),
      A_REV,
      bigIntToBeBytes(packetB),
      K
    )

    const M2_hash = sha1(A_REV, M1, K)

    return {
      K,
      A: A_REV,
      M1,
      M2: beBytesToBigInt(M2_hash),
    }
  }
}
