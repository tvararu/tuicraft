import { must } from "test/must";
import { hexBytes } from "test/quest-8325-packets";
import type { WorldConn } from "wow/client";
import { EntityStore } from "wow/entity-store";
import { registerQuestHandlers } from "wow/gameplay-handlers";
import { ObjectType, PLAYER_FIELDS } from "wow/protocol/entity-fields";
import { PacketReader } from "wow/protocol/packet";
import { OpcodeDispatch } from "wow/protocol/world";
import { type QuestEvent, QuestRuntime } from "wow/quests";

export function questCapture(self: bigint) {
  const entities = new EntityStore();
  entities.create(self, ObjectType.PLAYER, { createComplete: true });
  const sent: number[] = [];
  const events: QuestEvent[] = [];
  const runtime = new QuestRuntime({
    getEntity: (guid) => entities.get(guid),
    now: () => 1000,
    selfGuid: () => self,
    send: (opcode) => sent.push(opcode),
  });
  runtime.onEvent((event) => events.push(event));
  runtime.observeSelfCreate(must(entities.get(self)));
  runtime.observeQuestLog();
  const dispatch = new OpcodeDispatch();
  registerQuestHandlers({ dispatch, quests: runtime } as unknown as WorldConn);
  const packet = (opcode: number, hex: string) =>
    dispatch.handle(opcode, new PacketReader(hexBytes(hex)));
  const logQuest = (questId: number, flags: number, counters = 0) => {
    const fields = must(entities.get(self)).rawFields;
    const base = PLAYER_FIELDS.QUEST_LOG.offset;
    for (const [i, value] of [questId, flags, counters, 0, 0].entries())
      fields.set(base + i, value);
    runtime.observeQuestLog();
  };
  return { dispatch, entities, events, logQuest, packet, runtime, sent };
}
