import { must } from "test/must";
import { hexBytes } from "test/quest-8325-packets";
import { EntityStore } from "wow/entity-store";
import {
  registerLootHandlers,
  registerQuestHandlers,
} from "wow/gameplay-handlers";
import {
  ITEM_FIELDS,
  OBJECT_FIELDS,
  ObjectType,
  PLAYER_FIELDS,
} from "wow/protocol/entity-fields";
import { PacketReader } from "wow/protocol/packet";
import { OpcodeDispatch } from "wow/protocol/world";
import { type QuestEvent, QuestRuntime } from "wow/quests";
import type { WorldConn } from "wow/world-conn";

export function questCapture(self: bigint) {
  const entities = new EntityStore();
  entities.create(self, ObjectType.PLAYER, { createComplete: true });
  const sent: number[] = [];
  const bodies: string[] = [];
  const events: QuestEvent[] = [];
  const runtime = new QuestRuntime({
    getEntity: (guid) => entities.get(guid),
    now: () => 1000,
    selfGuid: () => self,
    send: (opcode, body) => {
      sent.push(opcode);
      bodies.push(Buffer.from(body ?? []).toString("hex"));
    },
  });
  runtime.onEvent((event) => events.push(event));
  runtime.observeSelfCreate(must(entities.get(self)));
  runtime.observeQuestLog();
  const dispatch = new OpcodeDispatch();
  const conn = { dispatch, quests: runtime } as unknown as WorldConn;
  registerQuestHandlers(conn);
  registerLootHandlers(conn);
  const packet = (opcode: number, hex: string) =>
    dispatch.handle(opcode, new PacketReader(hexBytes(hex)));
  const logQuest = (questId: number, flags: number, counters = 0) => {
    const fields = must(entities.get(self)).rawFields;
    const base = PLAYER_FIELDS.QUEST_LOG.offset;
    for (const [i, value] of [questId, flags, counters, 0, 0].entries())
      fields.set(base + i, value);
    runtime.observeQuestLog();
  };
  const carry = (item: bigint, slot: number, itemId: number, count: number) => {
    if (!entities.get(item))
      entities.create(item, ObjectType.ITEM, { createComplete: true });
    const guidWords = (guid: bigint) => [
      Number(guid & 0xff_ff_ff_ffn),
      Number(guid >> 32n),
    ];
    const fields = must(entities.get(item)).rawFields;
    fields.set(OBJECT_FIELDS.ENTRY.offset, itemId);
    fields.set(ITEM_FIELDS.STACK_COUNT.offset, count);
    for (const offset of [
      ITEM_FIELDS.OWNER.offset,
      ITEM_FIELDS.CONTAINED.offset,
    ])
      for (const [i, word] of guidWords(self).entries())
        fields.set(offset + i, word);
    const pack = PLAYER_FIELDS.PACK_SLOT_1.offset + (slot - 23) * 2;
    for (const [i, word] of guidWords(item).entries())
      must(entities.get(self)).rawFields.set(pack + i, word);
    runtime.observeQuestLog();
  };
  return { bodies, carry, entities, events, logQuest, packet, runtime, sent };
}
