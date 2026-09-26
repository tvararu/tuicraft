import { describe, expect, test } from "bun:test";
import { must } from "test/must";
import {
  dialog,
  giver,
  menu,
  packet,
  questId,
  self,
  setup,
  show,
} from "test/quest-fixtures";
import type { EntityStore } from "wow/entity-store";
import {
  ObjectType,
  PLAYER_FIELDS,
  UNIT_FIELDS,
} from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { readQuestLog } from "wow/quest-slots";

function requestItems(canComplete: boolean): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(giver);
  w.uint32LE(questId);
  w.cString("Quest");
  w.cString("Bring items");
  for (let i = 0; i < 6; i++) w.uint32LE(0);
  w.uint32LE(1);
  w.uint32LE(123);
  w.uint32LE(4);
  w.uint32LE(0);
  for (const flag of [canComplete ? 3 : 0, 4, 8, 16]) w.uint32LE(flag);
  return w.finish();
}

function words(...values: number[]): Uint8Array {
  const w = new PacketWriter();
  for (const value of values) w.uint32LE(value);
  return w.finish();
}

function setSlot(
  entities: EntityStore,
  slot: number,
  [id, state = 0, low = 0, high = 0]: readonly [
    id: number,
    state?: number,
    low?: number,
    high?: number,
  ],
): void {
  const fields = must(entities.get(self)).rawFields;
  for (const [i, value] of [id, state, low, high, 0].entries())
    fields.set(PLAYER_FIELDS.QUEST_LOG.offset + slot * 5 + i, value);
}

describe("quest interaction authority", () => {
  test("only offered quests and options can be selected, and a sent action consumes the menu", () => {
    const { runtime, sent } = setup();
    runtime.talk(giver);
    packet(runtime, GameOpcode.SMSG_GOSSIP_MESSAGE, menu());
    expect(() => runtime.selectQuest(43)).toThrow("quest_not_offered");
    expect(() => runtime.selectOption(6)).toThrow("option_not_offered");
    runtime.selectOption(5);
    expect(sent.at(-1)?.opcode).toBe(GameOpcode.CMSG_GOSSIP_SELECT_OPTION);
    const selection = new PacketReader(must(must(sent.at(-1)).body));
    expect(selection.uint64LE()).toBe(giver);
    expect(selection.uint32LE()).toBe(17);
    expect(selection.uint32LE()).toBe(5);
    expect(() => runtime.selectOption(5)).toThrow("gossip_not_open");
    expect(() => runtime.selectQuest(questId)).toThrow("quest_not_offered");
  });

  test("changing giver rejects a delayed old dialog and does not authorize an old quest", () => {
    const { runtime } = setup();
    show(runtime, "details");
    runtime.talk(3n);
    packet(
      runtime,
      GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS,
      dialog("details"),
    );
    expect(runtime.snapshot().dialog).toBeUndefined();
    expect(runtime.snapshot().lastError?.kind).toBe("stale_dialog");
    expect(() => runtime.accept()).toThrow("quest_details_not_open");
  });

  test("query metadata never authorizes acceptance and silence remains unknown", () => {
    const { runtime } = setup();
    runtime.query(questId);
    expect(runtime.snapshot().queries).toEqual([
      { questId, status: "unanswered", sentAt: 1000 },
    ]);
    expect(() => runtime.accept()).toThrow("quest_details_not_open");
    expect(() => runtime.complete(questId)).toThrow("quest_not_offered");
  });

  test("completion request requires an offered quest rather than log membership", () => {
    const { runtime, entities, sent } = setup();
    setSlot(entities, 0, [questId, 1]);
    runtime.observeQuestLog();
    expect(() => runtime.complete(questId)).toThrow("quest_not_offered");
    runtime.talk(giver);
    packet(runtime, GameOpcode.SMSG_GOSSIP_MESSAGE, menu());
    runtime.complete(questId);
    expect(sent.at(-1)?.opcode).toBe(GameOpcode.CMSG_QUESTGIVER_COMPLETE_QUEST);
    expect(runtime.snapshot().lastReward).toBeUndefined();
  });

  test("request-items preserves server requirements without inventing inventory counts", () => {
    const { runtime } = setup();
    runtime.talk(giver);
    packet(
      runtime,
      GameOpcode.SMSG_QUESTGIVER_REQUEST_ITEMS,
      requestItems(false),
    );
    expect(() => runtime.requestReward()).toThrow("quest_requirements_unmet");
    packet(
      runtime,
      GameOpcode.SMSG_QUESTGIVER_REQUEST_ITEMS,
      requestItems(true),
    );
    runtime.requestReward();
    expect(runtime.snapshot().lastIntent?.action).toBe("requestReward");
    expect(runtime.snapshot().lastReward).toBeUndefined();
  });

  test("reward index is constrained to the actual offer and sent choice is not reward evidence", () => {
    const { runtime, events } = setup();
    runtime.talk(giver);
    packet(
      runtime,
      GameOpcode.SMSG_QUESTGIVER_OFFER_REWARD,
      dialog("offer", giver, questId, 2),
    );
    expect(() => runtime.chooseReward(2)).toThrow("reward_not_offered");
    runtime.chooseReward(1);
    expect(runtime.snapshot().lastReward).toBeUndefined();
    expect(() => runtime.chooseReward(0)).toThrow("reward_offer_not_open");
    packet(
      runtime,
      GameOpcode.SMSG_QUESTGIVER_QUEST_COMPLETE,
      words(questId, 100, 20, 0, 0, 0),
    );
    expect(events.at(-1)?.type).toBe("rewarded");
    expect(runtime.snapshot().lastReward?.experience).toBe(100);
  });
});

describe("authoritative quest-log transitions", () => {
  test("sent acceptance, log addition, objective progress, completion and removal are distinct", () => {
    const { runtime, entities, events } = setup();
    show(runtime, "details");
    runtime.accept();
    expect(events.some((event) => event.type === "accepted")).toBe(false);
    setSlot(entities, 0, [questId]);
    runtime.observeQuestLog();
    expect(
      events.some(
        (event) => event.type === "accepted" && event.questId === questId,
      ),
    ).toBe(true);
    events.length = 0;
    setSlot(entities, 0, [questId, 0, 2]);
    runtime.observeQuestLog();
    expect(events.map((event) => event.type)).toContain("progress");
    expect(events.map((event) => event.type)).not.toContain("completed");
    setSlot(entities, 0, [questId, 1, 2]);
    runtime.observeQuestLog();
    expect(events.map((event) => event.type)).toContain("completed");
    runtime.abandon(0);
    expect(runtime.snapshot().log.slots[0]?.questId).toBe(questId);
    expect(events.map((event) => event.type)).not.toContain("removed");
    setSlot(entities, 0, [0]);
    runtime.observeQuestLog();
    expect(events.map((event) => event.type)).toContain("removed");
    expect(runtime.snapshot().lastReward).toBeUndefined();
  });

  test("a slot swap is not acceptance or removal and failed flags remain distinct", () => {
    const { runtime, entities, events } = setup();
    setSlot(entities, 0, [questId]);
    runtime.observeQuestLog();
    events.length = 0;
    setSlot(entities, 0, [0]);
    setSlot(entities, 1, [questId, 2]);
    runtime.observeQuestLog();
    expect(events.map((event) => event.type)).not.toContain("accepted");
    expect(events.map((event) => event.type)).not.toContain("removed");
    expect(events.map((event) => event.type)).toContain("failed");
    expect(events.map((event) => event.type)).not.toContain("completed");
  });

  test("missing self and partial CREATE never turn unknown fields into empty log facts", () => {
    const { runtime, entities, events } = setup();
    entities.create(self, ObjectType.PLAYER, {});
    runtime.observeQuestLog();
    expect(runtime.snapshot().log.complete).toBe(false);
    expect(runtime.snapshot().log.slots[0]?.questId).toBeUndefined();
    setSlot(entities, 0, [questId, 0, 0x00_02_00_01, 0x00_04_00_03]);
    runtime.observeQuestLog();
    expect(runtime.snapshot().log.slots[0]?.counters).toEqual([1, 2, 3, 4]);
    expect(events.some((event) => event.type === "accepted")).toBe(false);
    expect(() => runtime.abandon(1)).toThrow("quest_slot_unknown");
    expect(readQuestLog(self, () => entities.get(999n)).complete).toBe(false);
    expect(readQuestLog(2n, () => entities.get(self)).complete).toBe(false);
  });

  test("losing entity authority is not removal and recovering a log is not new acceptance", () => {
    const { runtime, entities, events } = setup();
    setSlot(entities, 0, [questId]);
    runtime.observeQuestLog();
    events.length = 0;
    entities.create(self, ObjectType.PLAYER, {});
    runtime.observeQuestLog();
    entities.create(self, ObjectType.PLAYER, { createComplete: true });
    runtime.observeSelfCreate(must(entities.get(self)));
    setSlot(entities, 0, [questId]);
    runtime.observeQuestLog();
    expect(
      events.some(
        (event) => event.type === "removed" || event.type === "accepted",
      ),
    ).toBe(false);
  });
});

describe("quest packet and lifecycle failures", () => {
  test("a confirmed world reset revokes the old giver and does not fabricate a quest outcome", () => {
    const { runtime, events } = setup();
    show(runtime, "details");
    runtime.accept();
    runtime.resetInteraction();
    packet(
      runtime,
      GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS,
      dialog("details"),
    );
    expect(() => runtime.accept()).toThrow("quest_details_not_open");
    expect(runtime.snapshot().unresolved).toMatchObject([{ action: "accept" }]);
    expect(
      events.some(
        (event) => event.type === "accepted" || event.type === "removed",
      ),
    ).toBe(false);
    runtime.talk(3n);
  });

  test("explicit cancel recovers a silent request only after server close", () => {
    const { runtime, events } = setup();
    runtime.talk(giver);
    runtime.cancel();
    expect(runtime.snapshot().unresolved).toMatchObject([{ action: "talk" }]);
    packet(runtime, GameOpcode.SMSG_GOSSIP_MESSAGE, menu());
    expect(runtime.snapshot().dialog).toBeUndefined();
    expect(() => runtime.talk(3n)).toThrow("quest_reply_unanswered");
    packet(runtime, GameOpcode.SMSG_QUESTGIVER_QUEST_INVALID, words(7));
    packet(runtime, GameOpcode.SMSG_GOSSIP_MESSAGE, menu());
    expect(runtime.snapshot().dialog).toBeUndefined();
    expect(() => runtime.talk(3n)).toThrow("quest_reply_unanswered");
    packet(runtime, GameOpcode.SMSG_GOSSIP_COMPLETE, new Uint8Array());
    runtime.talk(3n);
    expect(runtime.snapshot().pending?.guid).toBe(3n);
    expect(
      events.some(
        (event) => event.type === "accepted" || event.type === "rewarded",
      ),
    ).toBe(false);
  });

  test("a later server reply settles earlier dialog-only intents but never an accept", () => {
    const { runtime } = setup();
    const unresolved = () =>
      runtime.snapshot().unresolved.map((i) => `${i.action}:${i.reason}`);
    show(runtime, "details");
    runtime.accept();
    runtime.cancel();
    packet(runtime, GameOpcode.SMSG_GOSSIP_COMPLETE, new Uint8Array());
    runtime.talk(giver);
    runtime.resetInteraction();
    packet(runtime, GameOpcode.SMSG_GOSSIP_COMPLETE, new Uint8Array());
    expect(unresolved()).toEqual(["accept:cancelled", "talk:reset"]);
    runtime.talk(giver);
    runtime.cancel();
    expect(unresolved()).toEqual([
      "accept:cancelled",
      "talk:reset",
      "talk:cancelled",
    ]);
    packet(runtime, GameOpcode.SMSG_GOSSIP_COMPLETE, new Uint8Array());
    expect(unresolved()).toEqual(["accept:cancelled"]);
    runtime.talk(giver);
    runtime.resetInteraction();
    runtime.talk(giver);
    packet(runtime, GameOpcode.SMSG_GOSSIP_MESSAGE, menu());
    expect(unresolved()).toEqual(["accept:cancelled"]);
  });

  test("unanswered requests cannot be overwritten and old menus cannot satisfy a quest-specific request", () => {
    const { runtime } = setup();
    runtime.talk(giver);
    expect(() => runtime.talk(giver)).toThrow("quest_reply_unanswered");
    packet(runtime, GameOpcode.SMSG_GOSSIP_MESSAGE, menu());
    runtime.selectQuest(questId);
    packet(runtime, GameOpcode.SMSG_GOSSIP_MESSAGE, menu());
    expect(runtime.snapshot().dialog).toBeUndefined();
    packet(
      runtime,
      GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS,
      dialog("details"),
    );
    runtime.accept();
    packet(
      runtime,
      GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS,
      dialog("details"),
    );
    expect(() => runtime.accept()).toThrow("quest_details_not_open");
  });

  test("a reward for A must precede authorization of the same giver's next quest B", () => {
    const { runtime } = setup();
    show(runtime, "offer");
    runtime.chooseReward(0);
    packet(
      runtime,
      GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS,
      dialog("details", giver, 43),
    );
    expect(runtime.snapshot().dialog).toBeUndefined();
    packet(
      runtime,
      GameOpcode.SMSG_QUESTGIVER_QUEST_COMPLETE,
      words(questId, 100, 20, 0, 0, 0),
    );
    packet(
      runtime,
      GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS,
      dialog("details", giver, 43),
    );
    runtime.accept();
    expect(runtime.snapshot().lastIntent?.questId).toBe(43);
  });

  test("a same-quest reward reoffer permits retry without claiming reward success", () => {
    const { runtime } = setup();
    show(runtime, "offer");
    runtime.chooseReward(0);
    packet(runtime, GameOpcode.SMSG_QUESTGIVER_OFFER_REWARD, dialog("offer"));
    runtime.chooseReward(0);
    expect(runtime.snapshot().lastReward).toBeUndefined();
  });

  test("charmed CREATE cannot gain omitted-ID authority from a later uncharm", () => {
    const { runtime, entities, events } = setup();
    entities.create(self, ObjectType.PLAYER, { createComplete: true });
    const entity = must(entities.get(self));
    entity.rawFields.set(UNIT_FIELDS.CHARMEDBY.offset, 99);
    runtime.observeSelfCreate(entity);
    runtime.observeQuestLog();
    expect(runtime.snapshot().log.slots[0]?.questId).toBeUndefined();
    entity.rawFields.set(UNIT_FIELDS.CHARMEDBY.offset, 0);
    runtime.observeQuestLog();
    expect(runtime.snapshot().log.slots[0]?.questId).toBeUndefined();
    expect(runtime.snapshot().log.slots[0]?.flags).toBe(0);
    setSlot(entities, 0, [questId]);
    runtime.observeQuestLog();
    expect(runtime.snapshot().log.slots[0]?.questId).toBe(questId);
    expect(events.some((event) => event.type === "accepted")).toBe(false);
  });

  test("snapshot mutations cannot inject an offered quest or alter log authority", () => {
    const { runtime } = setup();
    runtime.talk(giver);
    packet(runtime, GameOpcode.SMSG_GOSSIP_MESSAGE, menu());
    const snapshot = runtime.snapshot();
    if (snapshot.dialog?.kind === "gossip")
      must(snapshot.dialog.data.quests[0]).questId = 999;
    must(snapshot.log.slots[0]).questId = 999;
    expect(() => runtime.selectQuest(999)).toThrow("quest_not_offered");
    expect(() => runtime.abandon(0)).toThrow("quest_slot_empty");
  });

  test("transport failure does not publish sent intent or consume a valid menu", () => {
    const { runtime, fail, events } = setup();
    show(runtime, "details");
    events.length = 0;
    fail();
    expect(() => runtime.accept()).toThrow("socket_closed");
    expect(runtime.snapshot().dialog?.kind).toBe("details");
    expect(events.some((event) => event.type === "intent")).toBe(false);
  });

  test("server invalid and quest-log-full replies expose errors, never acceptance", () => {
    const { runtime, events } = setup();
    show(runtime, "details");
    runtime.accept();
    packet(runtime, GameOpcode.SMSG_QUESTGIVER_QUEST_INVALID, words(7));
    expect(runtime.snapshot().lastError).toMatchObject({
      kind: "invalid",
      reason: 7,
    });
    packet(runtime, GameOpcode.SMSG_QUESTLOG_FULL, new Uint8Array());
    expect(runtime.snapshot().lastError?.kind).toBe("log_full");
    expect(events.some((event) => event.type === "accepted")).toBe(false);
  });

  test("kill notifications retain sign-magnitude targets, empty item updates carry no count", () => {
    const { runtime } = setup();
    const w = new PacketWriter();
    w.rawBytes(words(questId, 0x80_00_01_41, 1, 3));
    w.uint64LE(9n);
    packet(runtime, GameOpcode.SMSG_QUESTUPDATE_ADD_KILL, w.finish());
    expect(runtime.snapshot().lastProgress).toMatchObject({
      kind: "kill",
      data: { npcOrGoId: -321, currentCount: 1, requiredCount: 3 },
    });
    packet(runtime, GameOpcode.SMSG_QUESTUPDATE_ADD_ITEM, new Uint8Array());
    expect(runtime.snapshot().lastProgress).toMatchObject({
      kind: "item",
      data: { kind: "notification" },
    });
    expect(
      runtime.snapshot().log.slots.every((slot) => slot.questId === 0),
    ).toBe(true);
  });

  test("server close revokes acceptance and disposal prevents further actions and events", () => {
    const { runtime, events } = setup();
    show(runtime, "details");
    packet(runtime, GameOpcode.SMSG_GOSSIP_COMPLETE, new Uint8Array());
    expect(() => runtime.accept()).toThrow("quest_details_not_open");
    packet(
      runtime,
      GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS,
      dialog("details"),
    );
    expect(() => runtime.accept()).toThrow("quest_details_not_open");
    runtime.dispose();
    const count = events.length;
    packet(runtime, GameOpcode.SMSG_GOSSIP_MESSAGE, menu());
    expect(() => runtime.talk(giver)).toThrow("quests_disposed");
    expect(events.length).toBe(count);
  });
});
