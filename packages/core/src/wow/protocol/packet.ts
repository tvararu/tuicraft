export type Vec3 = { x: number; y: number; z: number };

export function joinGuid(low: number, high: number): bigint {
  return (BigInt(high >>> 0) << 32n) | BigInt(low >>> 0);
}

export function splitGuid(guid: bigint): { low: number; high: number } {
  return {
    low: Number(guid & 0xffffffffn),
    high: Number((guid >> 32n) & 0xffffffffn),
  };
}

export class PacketReader {
  private readonly data: Uint8Array;
  private readonly view: DataView;
  private pos = 0;

  constructor(data: Uint8Array, offset = 0) {
    this.data = data;
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

  uint64LE(): bigint {
    const v = this.view.getBigUint64(this.pos, true);
    this.pos += 8;
    return v;
  }

  floatLE(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  bytes(n: number): Uint8Array {
    if (n > this.remaining)
      throw new RangeError(`bytes(${n}) exceeds remaining ${this.remaining}`);
    const slice = this.data.slice(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  cString(): string {
    let end = this.pos;
    while (end < this.data.byteLength && this.data[end] !== 0) end++;
    const str = new TextDecoder().decode(this.data.slice(this.pos, end));
    this.pos = end < this.data.byteLength ? end + 1 : end;
    return str;
  }

  sizedString(): string {
    const bytes = this.bytes(this.uint32LE());
    const end = bytes.at(-1) === 0 ? bytes.byteLength - 1 : bytes.byteLength;
    return new TextDecoder().decode(bytes.subarray(0, end));
  }

  vec3(): Vec3 {
    return { x: this.floatLE(), y: this.floatLE(), z: this.floatLE() };
  }

  skip(n: number) {
    if (n > this.remaining)
      throw new RangeError(`skip(${n}) exceeds remaining ${this.remaining}`);
    this.pos += n;
  }

  packedGuid(): { low: number; high: number } {
    const mask = this.uint8();
    let low = 0;
    let high = 0;
    for (let i = 0; i < 8; i++) {
      if (mask & (1 << i)) {
        const byte = this.uint8();
        if (i < 4) low |= byte << (i * 8);
        else high |= byte << ((i - 4) * 8);
      }
    }
    return { low, high };
  }

  packedGuidBig(): bigint {
    const { low, high } = this.packedGuid();
    return joinGuid(low, high);
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

  uint64LE(v: bigint) {
    this.grow(8);
    this.view.setBigUint64(this.pos, v, true);
    this.pos += 8;
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

  packedGuid(low: number, high: number) {
    let mask = 0;
    const bytes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const byte =
        i < 4 ? (low >>> (i * 8)) & 0xff : (high >>> ((i - 4) * 8)) & 0xff;
      if (byte !== 0) {
        mask |= 1 << i;
        bytes.push(byte);
      }
    }
    this.uint8(mask);
    for (const b of bytes) this.uint8(b);
  }

  packedGuidBig(guid: bigint) {
    const { low, high } = splitGuid(guid);
    this.packedGuid(low, high);
  }

  vec3({ x, y, z }: Vec3) {
    this.floatLE(x);
    this.floatLE(y);
    this.floatLE(z);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}
