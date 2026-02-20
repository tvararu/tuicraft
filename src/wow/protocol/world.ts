import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import type { Arc4 } from "wow/crypto/arc4";

export const INCOMING_HEADER_SIZE = 4;
export const OUTGOING_HEADER_SIZE = 6;

export interface CharacterInfo {
  guidLow: number;
  guidHigh: number;
  name: string;
  race: number;
  classId: number;
  gender: number;
  level: number;
  zone: number;
  map: number;
}

const ADDON_ENTRIES = [
  { name: "Blizzard_AchievementUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_ArenaUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_AuctionUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_BarbershopUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_BattlefieldMinimap", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_BindingUI", flags: 225, modulusCrc: 1276933997, urlCrc: 0 },
  { name: "Blizzard_Calendar", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_CombatLog", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_CombatText", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_DebugTools", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_GlyphUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_GMChatUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_GMSurveyUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_GuildBankUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_InspectUI", flags: 92, modulusCrc: 1276933997, urlCrc: 0 },
  { name: "Blizzard_ItemSocketingUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_MacroUI", flags: 31, modulusCrc: 1276933997, urlCrc: 0 },
  { name: "Blizzard_RaidUI", flags: 201, modulusCrc: 1276933997, urlCrc: 0 },
  { name: "Blizzard_TalentUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_TimeManager", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_TokenUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_TradeSkillUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
  { name: "Blizzard_TrainerUI", flags: 0, modulusCrc: 0, urlCrc: 0 },
];

const ADDON_LAST_MODIFIED = 1636457673;

function buildAddonInfo(): Uint8Array {
  const w = new PacketWriter(512);
  w.uint32LE(ADDON_ENTRIES.length);
  for (const addon of ADDON_ENTRIES) {
    w.cString(addon.name);
    w.uint8(addon.flags);
    w.uint32LE(addon.modulusCrc);
    w.uint32LE(addon.urlCrc);
  }
  w.uint32LE(ADDON_LAST_MODIFIED);
  return w.finish();
}

export async function buildWorldAuthPacket(
  account: string,
  sessionKey: Uint8Array,
  serverSeed: Uint8Array,
  realmId: number,
  clientSeed?: Uint8Array,
): Promise<Uint8Array> {
  const upperAccount = account.toUpperCase();
  if (!clientSeed) clientSeed = crypto.getRandomValues(new Uint8Array(4));

  const digest = createHash("sha1")
    .update(upperAccount)
    .update(new Uint8Array(4))
    .update(clientSeed)
    .update(serverSeed)
    .update(sessionKey)
    .digest();

  const addonRaw = buildAddonInfo();
  const addonCompressed = deflateSync(addonRaw, { level: 9 });

  const w = new PacketWriter(256);
  w.uint32LE(12340);
  w.uint32LE(0);
  w.cString(upperAccount);
  w.uint32LE(0);
  w.rawBytes(clientSeed);
  w.uint32LE(0);
  w.uint32LE(0);
  w.uint32LE(realmId);
  w.uint32LE(2);
  w.uint32LE(0);
  w.rawBytes(new Uint8Array(digest));
  w.rawBytes(new Uint8Array(addonCompressed));

  return w.finish();
}

export function parseCharacterList(r: PacketReader): CharacterInfo[] {
  const count = r.uint8();
  const chars: CharacterInfo[] = [];
  for (let i = 0; i < count; i++) {
    const guidLow = r.uint32LE();
    const guidHigh = r.uint32LE();
    const name = r.cString();
    const race = r.uint8();
    const classId = r.uint8();
    const gender = r.uint8();
    r.skip(4);
    r.skip(1);
    const level = r.uint8();
    const zone = r.uint32LE();
    const map = r.uint32LE();
    r.skip(4 * 3);
    r.skip(4);
    r.skip(4);
    r.skip(4);
    r.skip(1);
    r.skip(4 * 3);
    for (let j = 0; j < 23; j++) {
      r.skip(4 + 1 + 4);
    }
    chars.push({
      guidLow,
      guidHigh,
      name,
      race,
      classId,
      gender,
      level,
      zone,
      map,
    });
  }
  return chars;
}

export class OpcodeDispatch {
  private handlers: Map<number, (reader: PacketReader) => void>;
  private expects: Map<number, (reader: PacketReader) => void>;

  constructor() {
    this.handlers = new Map();
    this.expects = new Map();
  }

  has(opcode: number): boolean {
    return this.handlers.has(opcode);
  }

  on(opcode: number, handler: (reader: PacketReader) => void) {
    this.handlers.set(opcode, handler);
  }

  expect(opcode: number, timeoutMs = 10_000): Promise<PacketReader> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.expects.delete(opcode);
        reject(
          new Error(`Timed out waiting for opcode 0x${opcode.toString(16)}`),
        );
      }, timeoutMs);
      this.expects.set(opcode, (reader) => {
        clearTimeout(timer);
        resolve(reader);
      });
    });
  }

  handle(opcode: number, reader: PacketReader) {
    const expectHandler = this.expects.get(opcode);
    if (expectHandler) {
      this.expects.delete(opcode);
      expectHandler(reader);
      return;
    }
    const handler = this.handlers.get(opcode);
    if (handler) handler(reader);
  }
}

export class AccumulatorBuffer {
  private buf: Uint8Array;

  constructor() {
    this.buf = new Uint8Array(0);
  }

  get length() {
    return this.buf.byteLength;
  }

  append(data: Uint8Array) {
    const next = new Uint8Array(this.buf.byteLength + data.byteLength);
    next.set(this.buf);
    next.set(data, this.buf.byteLength);
    this.buf = next;
  }

  peek(n: number): Uint8Array {
    return this.buf.slice(0, n);
  }

  drain(n: number): Uint8Array {
    const drained = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return drained;
  }
}

export function buildOutgoingPacket(
  opcode: number,
  body: Uint8Array,
  arc4?: Arc4,
): Uint8Array {
  const size = body.byteLength + 4;
  const header = new Uint8Array(OUTGOING_HEADER_SIZE);
  const view = new DataView(header.buffer);
  view.setUint16(0, size, false);
  view.setUint32(2, opcode, true);

  const encrypted = arc4 ? arc4.encrypt(header) : header;

  const packet = new Uint8Array(OUTGOING_HEADER_SIZE + body.byteLength);
  packet.set(encrypted);
  packet.set(body, OUTGOING_HEADER_SIZE);
  return packet;
}

export function decryptIncomingHeader(
  header: Uint8Array,
  arc4?: Arc4,
): { size: number; opcode: number } {
  const decrypted = arc4 ? arc4.decrypt(header) : header;
  const view = new DataView(
    decrypted.buffer,
    decrypted.byteOffset,
    decrypted.byteLength,
  );
  const size = view.getUint16(0, false);
  const opcode = view.getUint16(2, true);
  return { size, opcode };
}
