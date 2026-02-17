import { createHmac, createCipheriv, createDecipheriv } from "node:crypto"
import type { Cipher, Decipher } from "node:crypto"

const ENCRYPT_KEY = "C2B3723CC6AED9B5343C53EE2F4367CE"
const DECRYPT_KEY = "CC98AE04E897EACA12DDC09342915357"

export class Arc4 {
  private encCipher: Cipher
  private decCipher: Decipher

  constructor(sessionKey: Uint8Array) {
    const encKey = createHmac("sha1", Buffer.from(ENCRYPT_KEY, "hex")).update(sessionKey).digest()
    const decKey = createHmac("sha1", Buffer.from(DECRYPT_KEY, "hex")).update(sessionKey).digest()

    this.encCipher = createCipheriv("rc4", encKey, "")
    this.decCipher = createDecipheriv("rc4", decKey, "")

    const drop = new Uint8Array(1024)
    this.encCipher.update(drop)
    this.decCipher.update(drop)
  }

  encrypt(data: Uint8Array): Uint8Array {
    return new Uint8Array(this.encCipher.update(data))
  }

  decrypt(data: Uint8Array): Uint8Array {
    return new Uint8Array(this.decCipher.update(data))
  }
}
