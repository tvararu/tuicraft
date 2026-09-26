import { must } from "test/must";
import { EntityStore } from "wow/entity-store";
import { registerQuestHandlers } from "wow/gameplay-handlers";
import { ObjectType } from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { OpcodeDispatch } from "wow/protocol/world";
import { type QuestEvent, QuestRuntime } from "wow/quests";
import type { WorldConn } from "wow/world-conn";

export const self = 1n;
export const giver = 2n;
export const questId = 42;

export function setup() {
  const entities = new EntityStore();
  entities.create(self, ObjectType.PLAYER, { createComplete: true });
  const sent: { opcode: number; body: Uint8Array | undefined }[] = [];
  const events: QuestEvent[] = [];
  let failSend = false;
  const runtime = new QuestRuntime({
    getEntity: (guid) => entities.get(guid),
    now: () => 1000,
    selfGuid: () => self,
    send: (opcode, body) => {
      if (failSend) throw new Error("socket_closed");
      sent.push({ body, opcode });
    },
  });
  runtime.onEvent((event) => events.push(event));
  runtime.observeSelfCreate(must(entities.get(self)));
  runtime.observeQuestLog();
  return {
    entities,
    events,
    fail: () => {
      failSend = true;
    },
    runtime,
    sent,
  };
}

export function packet(
  runtime: QuestRuntime,
  opcode: number,
  data: Uint8Array,
): void {
  const dispatch = new OpcodeDispatch();
  registerQuestHandlers({ dispatch, quests: runtime } as unknown as WorldConn);
  dispatch.handle(opcode, new PacketReader(data));
}

export function menu(guid = giver, id = questId): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  w.uint32LE(17);
  w.uint32LE(1);
  w.uint32LE(1);
  w.uint32LE(5);
  w.uint8(0);
  w.uint8(0);
  w.uint32LE(0);
  w.cString("Continue");
  w.cString("");
  w.uint32LE(1);
  w.uint32LE(id);
  w.uint32LE(2);
  w.uint32LE(1);
  w.uint32LE(0);
  w.uint8(0);
  w.cString("Quest");
  return w.finish();
}

function rewards(w: PacketWriter, offer: boolean, choices: number): void {
  w.uint32LE(choices);
  for (let i = 0; i < choices; i++) {
    w.uint32LE(100 + i);
    w.uint32LE(1);
    w.uint32LE(200 + i);
  }
  w.uint32LE(0);
  for (let i = 0; i < 4; i++) w.uint32LE(0);
  if (offer) w.uint32LE(0);
  for (let i = 0; i < 21; i++) w.uint32LE(0);
}

export function dialog(
  kind: "details" | "offer",
  guid = giver,
  id = questId,
  choices = 0,
): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(guid);
  if (kind === "details") w.uint64LE(0n);
  w.uint32LE(id);
  w.cString("Quest");
  w.cString("Text");
  if (kind === "details") w.cString("Objectives");
  w.uint8(1);
  w.uint32LE(0);
  w.uint32LE(0);
  if (kind === "details") w.uint8(0);
  else w.uint32LE(0);
  rewards(w, kind === "offer", choices);
  if (kind === "details") w.uint32LE(0);
  return w.finish();
}

export function show(runtime: QuestRuntime, kind: "details" | "offer"): void {
  runtime.talk(giver);
  packet(
    runtime,
    kind === "details"
      ? GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS
      : GameOpcode.SMSG_QUESTGIVER_OFFER_REWARD,
    dialog(kind),
  );
}
