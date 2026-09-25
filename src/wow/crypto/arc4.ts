import {
  type Cipheriv,
  createCipheriv,
  createDecipheriv,
  createHmac,
  type Decipheriv,
} from "node:crypto";

const ENCRYPT_KEY = new Uint8Array([
  0xc2, 0xb3, 0x72, 0x3c, 0xc6, 0xae, 0xd9, 0xb5, 0x34, 0x3c, 0x53, 0xee, 0x2f,
  0x43, 0x67, 0xce,
]);
const DECRYPT_KEY = new Uint8Array([
  0xcc, 0x98, 0xae, 0x04, 0xe8, 0x97, 0xea, 0xca, 0x12, 0xdd, 0xc0, 0x93, 0x42,
  0x91, 0x53, 0x57,
]);

export class Arc4 {
  private readonly encCipher: Cipheriv;
  private readonly decCipher: Decipheriv;

  constructor(sessionKey: Uint8Array) {
    const encKey = createHmac("sha1", ENCRYPT_KEY).update(sessionKey).digest();
    const decKey = createHmac("sha1", DECRYPT_KEY).update(sessionKey).digest();

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
