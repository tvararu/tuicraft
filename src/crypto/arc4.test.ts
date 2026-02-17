import { test, expect } from "bun:test"
import { createHmac, createCipheriv, createDecipheriv } from "node:crypto"
import { Arc4 } from "./arc4"

test("Arc4 encrypts header bytes", () => {
  const sessionKey = new Uint8Array(40)
  for (let i = 0; i < 40; i++) sessionKey[i] = i

  const arc4 = new Arc4(sessionKey)
  const header = new Uint8Array([0x00, 0x04, 0x95, 0x00])
  const encrypted = arc4.encrypt(header)

  expect(encrypted).not.toEqual(header)
  expect(encrypted.byteLength).toBe(4)
})

test("Arc4 uses separate keys for encrypt and decrypt", () => {
  const sessionKey = new Uint8Array(40)
  for (let i = 0; i < 40; i++) sessionKey[i] = i

  const arc4 = new Arc4(sessionKey)
  const data = new Uint8Array([0x00, 0x08, 0xdc, 0x01, 0x00, 0x00])
  const encrypted = arc4.encrypt(new Uint8Array(data))
  const decrypted = arc4.decrypt(encrypted)

  expect(decrypted).not.toEqual(data)
})

test("Arc4 encrypt matches server-side decrypt with correct key", () => {
  const sessionKey = new Uint8Array(40)
  for (let i = 0; i < 40; i++) sessionKey[i] = i

  const arc4 = new Arc4(sessionKey)
  const original = new Uint8Array([0x00, 0x08, 0xdc, 0x01, 0x00, 0x00])
  const encrypted = arc4.encrypt(new Uint8Array(original))

  const serverDecKey = createHmac("sha1", Buffer.from("C2B3723CC6AED9B5343C53EE2F4367CE", "hex")).update(sessionKey).digest()
  const serverCipher = createDecipheriv("rc4", serverDecKey, "")
  serverCipher.update(new Uint8Array(1024))
  const decrypted = new Uint8Array(serverCipher.update(encrypted))

  expect(decrypted).toEqual(original)
})

test("Arc4 maintains cipher state across multiple calls", () => {
  const sessionKey = new Uint8Array(40).fill(0xab)

  const arc4 = new Arc4(sessionKey)

  const h1 = new Uint8Array([0x00, 0x04, 0x96, 0x00])
  const h2 = new Uint8Array([0x00, 0x04, 0x96, 0x00])

  const e1 = arc4.encrypt(new Uint8Array(h1))
  const e2 = arc4.encrypt(new Uint8Array(h2))

  expect(e1).not.toEqual(e2)
})

test("Arc4 uses HMAC-SHA1 key derivation", () => {
  const k1 = new Uint8Array(40).fill(0x00)
  const k2 = new Uint8Array(40).fill(0x01)

  const arc4a = new Arc4(k1)
  const arc4b = new Arc4(k2)

  const header = new Uint8Array([0x00, 0x04, 0x95, 0x00])
  const e1 = arc4a.encrypt(new Uint8Array(header))
  const e2 = arc4b.encrypt(new Uint8Array(header))

  expect(e1).not.toEqual(e2)
})
