import { PacketReader, PacketWriter } from "./packet"
import { AuthOpcode } from "./opcodes"
import { leBytesToBigInt, beBytesToBigInt, type SRPResult } from "../crypto/srp"

export interface LogonChallengeResult {
  status: number
  B?: bigint
  g?: bigint
  N?: bigint
  salt?: Uint8Array
}

export interface Realm {
  icon: number
  lock: number
  flags: number
  name: string
  host: string
  port: number
  population: number
  characters: number
  timezone: number
  id: number
}

function reverseString(s: string): string {
  return s.split("").reverse().join("")
}

export function buildLogonChallenge(account: string): Uint8Array {
  account = account.toUpperCase()
  const w = new PacketWriter()

  w.uint8(AuthOpcode.LOGON_CHALLENGE)
  w.uint8(0x08)

  const accountBytes = new TextEncoder().encode(account)
  const packetSize = 30 + accountBytes.length
  w.uint16LE(packetSize)

  w.rawBytes(new TextEncoder().encode(reverseString("WoW\0")))
  w.uint8(3)
  w.uint8(3)
  w.uint8(5)
  w.uint16LE(12340)
  w.rawBytes(new TextEncoder().encode(reverseString("68x\0")))
  w.rawBytes(new TextEncoder().encode(reverseString("niW\0")))
  w.rawBytes(new TextEncoder().encode(reverseString("enUS")))
  w.uint32LE(0)
  w.rawBytes(new Uint8Array([127, 0, 0, 1]))
  w.uint8(accountBytes.length)
  w.rawBytes(accountBytes)

  return w.finish()
}

export function parseLogonChallengeResponse(r: PacketReader): LogonChallengeResult {
  r.skip(1)
  const status = r.uint8()

  if (status !== 0x00) {
    return { status }
  }

  const B = leBytesToBigInt(r.bytes(32))
  const gLen = r.uint8()
  const g = leBytesToBigInt(r.bytes(gLen))
  const nLen = r.uint8()
  const N = leBytesToBigInt(r.bytes(nLen))
  const salt = r.bytes(32)
  r.skip(16)
  r.skip(1)

  return { status, B, g, N, salt }
}

export function buildLogonProof(srpResult: SRPResult): Uint8Array {
  const w = new PacketWriter()
  w.uint8(AuthOpcode.LOGON_PROOF)
  w.rawBytes(srpResult.A)
  w.rawBytes(srpResult.M1)
  w.rawBytes(new Uint8Array(20))
  w.uint8(0x00)
  w.uint8(0x00)
  return w.finish()
}

export function parseLogonProofResponse(r: PacketReader): { status: number; M2?: bigint } {
  const status = r.uint8()
  if (status !== 0x00) {
    return { status }
  }
  const M2 = beBytesToBigInt(r.bytes(20))
  return { status, M2 }
}

export function buildRealmListRequest(): Uint8Array {
  const w = new PacketWriter()
  w.uint8(AuthOpcode.REALM_LIST)
  w.uint32LE(0)
  return w.finish()
}

export function parseRealmList(r: PacketReader): Realm[] {
  r.uint16LE()
  r.uint32LE()
  const count = r.uint16LE()

  const realms: Realm[] = []
  for (let i = 0; i < count; i++) {
    const icon = r.uint8()
    const lock = r.uint8()
    const flags = r.uint8()
    const name = r.cString()
    const address = r.cString()
    const [host, portStr] = address.split(":")
    const port = parseInt(portStr, 10)
    const population = r.uint32LE()
    const characters = r.uint8()
    const timezone = r.uint8()
    const id = r.uint8()

    if (flags & 0x04) {
      r.skip(3)
      r.skip(1)
    }

    realms.push({ icon, lock, flags, name, host, port, population, characters, timezone, id })
  }

  return realms
}
