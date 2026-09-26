import { describe, expect, test } from "bun:test";
import { must } from "test/must";
import { captured8325, ERONA_GUID, hexBytes } from "test/quest-8325-packets";
import type { WorldConn } from "wow/client";
import { EntityStore } from "wow/entity-store";
import { registerQuestHandlers } from "wow/gameplay-handlers";
import { ObjectType, PLAYER_FIELDS } from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketReader } from "wow/protocol/packet";
import { OpcodeDispatch } from "wow/protocol/world";
import { type QuestEvent, QuestRuntime } from "wow/quests";

const self = 0x9fbn;
const questId = 8325;

function setup() {
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
  const logQuest = (flags: number, kills: number) => {
    const fields = must(entities.get(self)).rawFields;
    const base = PLAYER_FIELDS.QUEST_LOG.offset;
    for (const [i, value] of [questId, flags, kills, 0, 0].entries())
      fields.set(base + i, value);
    runtime.observeQuestLog();
  };
  return { entities, events, logQuest, packet, runtime, sent };
}

describe("quest 8325 captured from the live server", () => {
  test("auto-accept details log the quest on select, so accept is refused", () => {
    const { events, logQuest, packet, runtime, sent } = setup();
    runtime.talk(ERONA_GUID);
    packet(GameOpcode.SMSG_GOSSIP_MESSAGE, captured8325.offerMenu);
    const menu = runtime.snapshot().dialog;
    expect(menu?.kind === "gossip" && menu.data.quests).toEqual([
      expect.objectContaining({ icon: 2, questId }),
    ]);
    runtime.selectQuest(questId);
    expect(sent.at(-1)).toBe(GameOpcode.CMSG_QUESTGIVER_QUERY_QUEST);
    packet(GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS, captured8325.details);
    const details = must(runtime.snapshot().dialog);
    if (details.kind !== "details") throw new Error(details.kind);
    expect(details.data.flags & 0x8_00_00).toBe(0x8_00_00);
    expect(details.data.rewards.choices.map((c) => c.itemId)).toEqual([
      20_997, 20_998,
    ]);
    expect(details.data.rewards.money).toBe(30);
    logQuest(0, 0);
    expect(events.some((e) => e.type === "accepted")).toBe(true);
    expect(() => runtime.accept()).toThrow("quest_already_in_log");
    packet(
      GameOpcode.SMSG_QUESTGIVER_QUEST_INVALID,
      captured8325.alreadyOnQuest,
    );
    expect(runtime.snapshot().lastError).toMatchObject({
      kind: "invalid",
      reason: 13,
    });
  });

  test("each Mana Wyrm kill reports server progress from 1/8 to 8/8", () => {
    const { events, packet } = setup();
    for (const hex of captured8325.kills)
      packet(GameOpcode.SMSG_QUESTUPDATE_ADD_KILL, hex);
    const kills = events.flatMap((event) =>
      event.type === "progress" && event.state.lastProgress?.kind === "kill"
        ? [event.state.lastProgress.data]
        : [],
    );
    expect(kills.map((kill) => kill.currentCount)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    for (const kill of kills)
      expect(kill).toMatchObject({
        npcOrGoId: 15_274,
        questId,
        requiredCount: 8,
      });
  });

  test("turn-in selects the complete quest, offers rewards and notifies the reward", () => {
    const { events, logQuest, packet, runtime, sent } = setup();
    logQuest(1, 8);
    runtime.talk(ERONA_GUID);
    packet(GameOpcode.SMSG_GOSSIP_MESSAGE, captured8325.turnInMenu);
    runtime.selectQuest(questId);
    expect(sent.at(-1)).toBe(GameOpcode.CMSG_QUESTGIVER_COMPLETE_QUEST);
    packet(GameOpcode.SMSG_QUESTGIVER_OFFER_REWARD, captured8325.offerReward);
    expect(runtime.snapshot().dialog?.kind).toBe("offer");
    runtime.chooseReward(0);
    expect(sent.at(-1)).toBe(GameOpcode.CMSG_QUESTGIVER_CHOOSE_REWARD);
    expect(runtime.snapshot().lastReward).toBeUndefined();
    packet(
      GameOpcode.SMSG_QUESTGIVER_QUEST_COMPLETE,
      captured8325.questComplete,
    );
    expect(runtime.snapshot().lastReward).toMatchObject({
      experience: 100,
      money: 30,
      questId,
    });
    expect(runtime.snapshot().pending).toBeUndefined();
    expect(events.at(-1)?.type).toBe("rewarded");
  });
});
