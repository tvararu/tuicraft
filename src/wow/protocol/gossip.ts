import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { parseQuestMenuEntry, type QuestMenuEntry } from "wow/protocol/quest";

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

const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

function string(reader: PacketReader): string {
  const bytes: number[] = [];
  for (let byte = reader.uint8(); byte !== 0; byte = reader.uint8())
    bytes.push(byte);
  return decoder.decode(Uint8Array.from(bytes));
}

function checkCount(reader: PacketReader, count: number, width: number): void {
  if (count > Math.floor(reader.remaining / width))
    throw new RangeError("Gossip record count exceeds remaining payload");
}

function guidRequest(guid: bigint, size: number): PacketWriter {
  if (guid < 0n || guid > 0xffffffffffffffffn)
    throw new RangeError("GUID outside uint64 range");
  const writer = new PacketWriter(size);
  writer.uint64LE(guid);
  return writer;
}

function checkUnsigned(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new RangeError("Gossip request integer outside uint32 range");
}

export function buildGossipHello(guid: bigint): Uint8Array {
  return guidRequest(guid, 8).finish();
}

export function buildGossipSelectOption(
  guid: bigint,
  menuId: number,
  optionIndex: number,
  code?: string,
): Uint8Array {
  checkUnsigned(menuId);
  checkUnsigned(optionIndex);
  if (code?.includes("\0"))
    throw new RangeError("Gossip code contains a NUL character");
  const writer = guidRequest(guid, 16);
  writer.uint32LE(menuId);
  writer.uint32LE(optionIndex);
  if (code !== undefined) writer.cString(code);
  return writer.finish();
}

export function parseGossipMessage(reader: PacketReader): GossipMessage {
  const guid = reader.uint64LE();
  const menuId = reader.uint32LE();
  const titleTextId = reader.uint32LE();
  const optionCount = reader.uint32LE();
  checkCount(reader, optionCount, 12);
  const options: GossipOption[] = [];
  for (let i = 0; i < optionCount; i++) {
    options.push({
      optionIndex: reader.uint32LE(),
      icon: reader.uint8(),
      coded: reader.uint8(),
      money: reader.uint32LE(),
      text: string(reader),
      boxText: string(reader),
    });
  }
  const questCount = reader.uint32LE();
  checkCount(reader, questCount, 18);
  const quests: QuestMenuEntry[] = [];
  for (let i = 0; i < questCount; i++) quests.push(parseQuestMenuEntry(reader));
  if (reader.remaining !== 0)
    throw new RangeError("Unexpected trailing gossip payload");
  return { guid, menuId, titleTextId, options, quests };
}
