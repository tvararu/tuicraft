import { type PacketReader, PacketWriter } from "wow/protocol/packet";

export const ItemSpellTrigger = { ON_USE: 0 } as const;

const ITEM_SPELL_SLOTS = 5;
const WORDS_FROM_FLAGS_TO_STATS = 19;
const WORDS_FROM_SCALING_TO_SPELLS = 2 + 2 * 3 + 7 + 3;

export type ItemSpell = {
  id: number;
  trigger: number;
  charges: number;
  cooldownMs: number;
  category: number;
  categoryCooldownMs: number;
};

export type ItemTemplate = {
  entry: number;
  name: string;
  quality: number;
  itemClass: number;
  subclass: number;
  spells: ItemSpell[];
};

export type ItemQueryResponse = {
  entry: number;
  template: ItemTemplate | undefined;
};

export type ItemUseRequest = {
  bag: number;
  slot: number;
  castCount: number;
  spellId: number;
  itemGuid: bigint;
};

export function buildItemQuery(entry: number): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(entry);
  return w.finish();
}

export function parseItemQueryResponse(r: PacketReader): ItemQueryResponse {
  const raw = r.uint32LE();
  const entry = raw & 0x7f_ff_ff_ff;
  if (raw & 0x80_00_00_00) return { entry, template: undefined };
  const itemClass = r.uint32LE();
  const subclass = r.uint32LE();
  r.skip(4);
  const name = r.cString();
  for (let i = 0; i < 3; i++) r.cString();
  r.skip(4);
  const quality = r.uint32LE();
  r.skip(WORDS_FROM_FLAGS_TO_STATS * 4);
  const stats = r.uint32LE();
  r.skip((stats * 2 + WORDS_FROM_SCALING_TO_SPELLS) * 4);
  const spells: ItemSpell[] = [];
  for (let i = 0; i < ITEM_SPELL_SLOTS; i++) {
    const spell = {
      id: r.uint32LE(),
      trigger: r.uint32LE(),
      charges: r.uint32LE() | 0,
      cooldownMs: r.uint32LE() | 0,
      category: r.uint32LE(),
      categoryCooldownMs: r.uint32LE() | 0,
    };
    if (spell.id !== 0) spells.push(spell);
  }
  return {
    entry,
    template: { entry, name, quality, itemClass, subclass, spells },
  };
}

export function buildUseItem(request: ItemUseRequest): Uint8Array {
  const w = new PacketWriter();
  w.uint8(request.bag);
  w.uint8(request.slot);
  w.uint8(request.castCount);
  w.uint32LE(request.spellId);
  w.uint64LE(request.itemGuid);
  w.uint32LE(0);
  w.uint8(0);
  w.uint32LE(0);
  return w.finish();
}
