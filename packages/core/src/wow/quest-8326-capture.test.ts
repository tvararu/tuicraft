import { describe, expect, test } from "bun:test";
import { must } from "#test-support/must";
import { ERONA_GUID } from "#test-support/quest-8325-packets";
import { captured8326 } from "#test-support/quest-8326-packets";
import { questCapture } from "#test-support/quest-capture-fixtures";
import { GameOpcode } from "#wow/protocol/opcodes";

const questId = 8326;
const collar = 20_797;
const stack = 0x40_00_00_00_00_0f_0b_a2n;
const merged = 0xff_ff_ff_ff;

function setup() {
  const capture = questCapture(0xa12n);
  capture.packet(GameOpcode.SMSG_QUEST_QUERY_RESPONSE, captured8326.query);
  capture.logQuest(questId, 0);
  capture.events.length = 0;
  return capture;
}

describe("quest 8326 captured from the live server", () => {
  test("the query names 8 Lynx Collars and the auto-accept details log it", () => {
    const capture = questCapture(0xa12n);
    const { logQuest, packet, runtime } = capture;
    packet(GameOpcode.SMSG_QUEST_QUERY_RESPONSE, captured8326.query);
    runtime.talk(ERONA_GUID);
    packet(GameOpcode.SMSG_GOSSIP_MESSAGE, captured8326.offerMenu);
    runtime.selectQuest(questId);
    packet(GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS, captured8326.details);
    logQuest(questId, 0);
    expect(runtime.snapshot().items).toEqual([
      { carried: 0, itemId: collar, questId, required: 8 },
    ]);
  });

  test("each collar push is correlated with the observed stack, never the log counters", () => {
    const { carry, events, packet, runtime } = setup();
    const counts = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const [i, count] of counts.entries()) {
      carry(stack, 27, collar, count);
      packet(
        GameOpcode.SMSG_ITEM_PUSH_RESULT,
        must(captured8326.collarPushes[i]),
      );
    }
    const collected = events.flatMap((event) =>
      event.source === "inventory" &&
      event.state.lastProgress?.kind === "collect"
        ? [event.state.lastProgress]
        : [],
    );
    expect(collected.map((progress) => progress.carried)).toEqual(counts);
    expect(collected.map((progress) => progress.totalCount)).toEqual(counts);
    expect(collected.map((progress) => progress.slot)).toEqual([
      27,
      ...counts.slice(1).map(() => merged),
    ]);
    expect(collected.every((p) => p.required === 8 && p.bag === 255)).toBe(
      true,
    );
    expect(runtime.snapshot().log.slots[0]?.counters).toEqual([0, 0, 0, 0]);
    expect(runtime.snapshot().itemPushes).toEqual([]);
  });

  test("a push ahead of its stack update waits for the bags", () => {
    const { carry, events, packet, runtime } = setup();
    carry(stack, 27, collar, 1);
    packet(
      GameOpcode.SMSG_ITEM_PUSH_RESULT,
      must(captured8326.collarPushes[1]),
    );
    expect(runtime.snapshot().itemPushes).toMatchObject([{ totalCount: 2 }]);
    expect(events.some((event) => event.source === "inventory")).toBe(false);
    carry(stack, 27, collar, 2);
    expect(runtime.snapshot().itemPushes).toEqual([]);
    expect(runtime.snapshot().lastProgress).toMatchObject({
      carried: 2,
      kind: "collect",
      totalCount: 2,
    });
  });

  test("a quest already logged at login is queried once and its collars still count", () => {
    const { bodies, carry, events, logQuest, packet, runtime, sent } =
      questCapture(0xa12n);
    logQuest(questId, 0);
    logQuest(questId, 0, 1);
    const queries = sent.flatMap((opcode, i) =>
      opcode === GameOpcode.CMSG_QUEST_QUERY ? [bodies[i]] : [],
    );
    expect(queries).toEqual(["86200000"]);
    expect(runtime.snapshot().items).toEqual([]);
    packet(GameOpcode.SMSG_QUEST_QUERY_RESPONSE, captured8326.query);
    carry(stack, 27, collar, 1);
    packet(
      GameOpcode.SMSG_ITEM_PUSH_RESULT,
      must(captured8326.collarPushes[0]),
    );
    expect(runtime.snapshot().items).toEqual([
      { carried: 1, itemId: collar, questId, required: 8 },
    ]);
    expect(events.at(-1)).toMatchObject({
      source: "inventory",
      state: { lastProgress: { carried: 1, kind: "collect", questId } },
      type: "progress",
    });
  });

  test("turn-in asks for the collars, offers rewards and notifies the reward", () => {
    const { carry, logQuest, packet, runtime, sent } = setup();
    carry(stack, 27, collar, 8);
    logQuest(questId, 1);
    runtime.talk(ERONA_GUID);
    packet(GameOpcode.SMSG_GOSSIP_MESSAGE, captured8326.turnInMenu);
    runtime.selectQuest(questId);
    packet(GameOpcode.SMSG_QUESTGIVER_REQUEST_ITEMS, captured8326.requestItems);
    const asked = must(runtime.snapshot().dialog);
    if (asked.kind !== "requestItems") throw new Error(asked.kind);
    expect(asked.data.items).toMatchObject([{ count: 8, itemId: collar }]);
    runtime.requestReward();
    packet(GameOpcode.SMSG_QUESTGIVER_OFFER_REWARD, captured8326.offerReward);
    runtime.chooseReward(0);
    expect(sent.at(-1)).toBe(GameOpcode.CMSG_QUESTGIVER_CHOOSE_REWARD);
    packet(GameOpcode.SMSG_ITEM_PUSH_RESULT, captured8326.rewardPush);
    expect(runtime.snapshot().itemPushes).toEqual([]);
    expect(runtime.snapshot().lastProgress).toBeUndefined();
    packet(
      GameOpcode.SMSG_QUESTGIVER_QUEST_COMPLETE,
      captured8326.questComplete,
    );
    expect(runtime.snapshot().lastReward).toMatchObject({
      experience: 250,
      money: 50,
      questId,
    });
  });
});
