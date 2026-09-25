import type { PacketReader } from "wow/protocol/packet";

export function parseUpdateMask(r: PacketReader): Map<number, number> {
  const blockCount = r.uint8();
  const masks: number[] = [];
  for (let i = 0; i < blockCount; i++) {
    masks.push(r.uint32LE());
  }
  const fields = new Map<number, number>();
  for (const [block, mask] of masks.entries()) {
    if (mask === 0) continue;
    for (let bit = 0; bit < 32; bit++) {
      if (mask & (1 << bit)) {
        fields.set(block * 32 + bit, r.uint32LE());
      }
    }
  }
  return fields;
}
