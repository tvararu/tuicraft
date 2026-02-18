import { PacketReader, PacketWriter } from "protocol/packet";
import { ChatType } from "protocol/opcodes";

export type ChatMessage = {
  type: number;
  language: number;
  senderGuidLow: number;
  senderGuidHigh: number;
  message: string;
  channel?: string;
};

export type NameQueryResult = {
  guidLow: number;
  found: boolean;
  name?: string;
};

export type WhoResult = {
  name: string;
  guild: string;
  level: number;
  classId: number;
  race: number;
  gender: number;
  zone: number;
};

export function parseChatMessage(r: PacketReader): ChatMessage {
  const type = r.uint8();
  const language = r.uint32LE();
  const senderGuidLow = r.uint32LE();
  const senderGuidHigh = r.uint32LE();
  r.uint32LE();

  let channel: string | undefined;
  if (type === ChatType.CHANNEL) {
    channel = r.cString();
  }

  r.uint32LE();
  r.uint32LE();
  const messageLength = r.uint32LE();
  const messageBytes = r.bytes(messageLength);
  const end =
    messageLength > 0 && messageBytes[messageLength - 1] === 0
      ? messageLength - 1
      : messageLength;
  const message = new TextDecoder().decode(messageBytes.subarray(0, end));
  if (r.remaining > 0) r.uint8();

  return { type, language, senderGuidLow, senderGuidHigh, message, channel };
}

export function buildChatMessage(
  type: number,
  message: string,
  target?: string,
): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(type);
  w.uint32LE(0);
  if (type === ChatType.WHISPER || type === ChatType.CHANNEL) {
    w.cString(target ?? "");
  }
  w.cString(message);
  return w.finish();
}

export function buildNameQuery(guidLow: number, guidHigh: number): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(guidLow);
  w.uint32LE(guidHigh);
  return w.finish();
}

export function parseNameQueryResponse(r: PacketReader): NameQueryResult {
  const { low: guidLow } = r.packedGuid();
  const notFound = r.uint8();
  if (notFound) return { guidLow, found: false };
  const name = r.cString();
  return { guidLow, found: true, name };
}

export function buildWhoRequest(opts: {
  name?: string;
  minLevel?: number;
  maxLevel?: number;
}): Uint8Array {
  const w = new PacketWriter();
  w.uint32LE(opts.minLevel ?? 0);
  w.uint32LE(opts.maxLevel ?? 100);
  w.cString(opts.name ?? "");
  w.cString("");
  w.uint32LE(0xffffffff);
  w.uint32LE(0xffffffff);
  w.uint32LE(0);
  w.uint32LE(0);
  return w.finish();
}

export function parseWhoResponse(r: PacketReader): WhoResult[] {
  const displayCount = r.uint32LE();
  r.uint32LE();
  const results: WhoResult[] = [];
  for (let i = 0; i < displayCount; i++) {
    results.push({
      name: r.cString(),
      guild: r.cString(),
      level: r.uint32LE(),
      classId: r.uint32LE(),
      race: r.uint32LE(),
      gender: r.uint8(),
      zone: r.uint32LE(),
    });
  }
  return results;
}
