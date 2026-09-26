import { type PacketReader, PacketWriter } from "#wow/protocol/packet";
import {
  parseQuestMenuEntry,
  type QuestMenuEntry,
} from "#wow/protocol/questgiver";

export type GossipOption = {
  optionIndex: number;
  icon: number;
  coded: number;
  money: number;
  text: string;
  boxText: string;
};

export type GossipMessage = {
  guid: bigint;
  menuId: number;
  titleTextId: number;
  options: GossipOption[];
  quests: QuestMenuEntry[];
};

export type GossipSelect = {
  guid: bigint;
  menuId: number;
  optionIndex: number;
  code?: string;
};

export function buildGossipHello(guid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  return w.finish();
}

export function buildGossipSelectOption({
  guid,
  menuId,
  optionIndex,
  code,
}: GossipSelect): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  w.uint32LE(menuId);
  w.uint32LE(optionIndex);
  if (code !== undefined) w.cString(code);
  return w.finish();
}

function parseOption(r: PacketReader): GossipOption {
  return {
    optionIndex: r.uint32LE(),
    icon: r.uint8(),
    coded: r.uint8(),
    money: r.uint32LE(),
    text: r.cString(),
    boxText: r.cString(),
  };
}

function list<T>(r: PacketReader, parse: (r: PacketReader) => T): T[] {
  const count = r.uint32LE();
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(parse(r));
  return out;
}

export function parseGossipMessage(r: PacketReader): GossipMessage {
  const guid = r.uint64LE();
  const menuId = r.uint32LE();
  const titleTextId = r.uint32LE();
  const options = list(r, parseOption);
  const quests = list(r, parseQuestMenuEntry);
  return { guid, menuId, titleTextId, options, quests };
}
