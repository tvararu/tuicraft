import { describe, expect, test } from "bun:test";
import { ARENA_GUID, captured215 } from "test/quest-215-packets";
import { captured8325, ERONA_GUID } from "test/quest-8325-packets";
import { questCapture } from "test/quest-capture-fixtures";
import { GameOpcode } from "wow/protocol/opcodes";
import { QUEST_REPLY_TIMEOUT_MS } from "wow/quests-requests";

const setup = () => questCapture(0x9fbn);

describe("an unanswered quest request is bounded", () => {
  test("a trainer list answers the training option and the next giver talks", () => {
    const { bodies, events, packet, runtime } = setup();
    runtime.talk(ARENA_GUID);
    packet(GameOpcode.SMSG_GOSSIP_MESSAGE, captured215.arenaGossip);
    runtime.selectOption(0);
    expect(bodies.at(-1)).toBe(captured215.arenaSelect);
    packet(GameOpcode.SMSG_TRAINER_LIST, captured215.trainerList);
    expect(runtime.snapshot()).toMatchObject({
      dialog: undefined,
      giver: undefined,
      lastError: {
        guid: ARENA_GUID,
        kind: "unsupported_window",
        window: "trainer",
      },
      pending: undefined,
      unresolved: [],
    });
    expect(events.at(-1)).toMatchObject({
      detail: "unsupported_window:trainer",
      type: "window",
    });
    runtime.talk(ERONA_GUID);
    packet(GameOpcode.SMSG_GOSSIP_MESSAGE, captured215.eronaGossip);
    expect(runtime.snapshot().dialog?.kind).toBe("gossip");
  });

  test("another giver's trainer list does not answer the pending request", () => {
    const { packet, runtime } = setup();
    runtime.talk(ERONA_GUID);
    packet(GameOpcode.SMSG_TRAINER_LIST, captured215.trainerList);
    expect(runtime.snapshot().pending?.guid).toBe(ERONA_GUID);
    expect(runtime.snapshot().lastError).toBeUndefined();
  });

  test("the refusal names the request, the bound and the recovery", () => {
    const { advance, runtime } = setup();
    runtime.talk(ERONA_GUID);
    advance(1200);
    expect(() => runtime.talk(3n)).toThrow(
      "quest_reply_unanswered: talk 0xf130003bae004980 unanswered for 1.2s; it expires as no_reply after 5s, or run cancel-interaction",
    );
  });

  test("an ignored talk expires as no_reply, stays unresolved and frees the next giver", () => {
    const { advance, bodies, events, runtime } = setup();
    runtime.talk(ERONA_GUID);
    expect(bodies).toEqual([captured215.outOfRangeHello]);
    advance(QUEST_REPLY_TIMEOUT_MS - 1);
    expect(() => runtime.talk(3n)).toThrow("quest_reply_unanswered");
    advance(1);
    runtime.talk(3n);
    expect(runtime.snapshot().pending).toMatchObject({
      action: "talk",
      guid: 3n,
    });
    expect(runtime.snapshot().unresolved).toEqual([
      { action: "talk", at: 1000, guid: ERONA_GUID, reason: "no_reply" },
    ]);
    expect(events.find((event) => event.type === "expired")).toMatchObject({
      detail: "no_reply",
      source: "lifecycle",
    });
  });

  test("a reply after the bound is stale and does not reopen the old giver", () => {
    const { advance, packet, runtime } = setup();
    runtime.talk(ERONA_GUID);
    advance(QUEST_REPLY_TIMEOUT_MS);
    packet(GameOpcode.SMSG_GOSSIP_MESSAGE, captured8325.offerMenu);
    expect(runtime.snapshot().dialog).toBeUndefined();
    expect(runtime.snapshot().lastError?.kind).toBe("stale_dialog");
  });

  test("an expired acceptance is still settled by the quest log", () => {
    const { advance, logQuest, packet, runtime } = setup();
    runtime.talk(ERONA_GUID);
    packet(GameOpcode.SMSG_GOSSIP_MESSAGE, captured8325.offerMenu);
    runtime.selectQuest(8325);
    packet(GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS, captured8325.details);
    runtime.accept();
    advance(QUEST_REPLY_TIMEOUT_MS);
    expect(runtime.snapshot().unresolved).toMatchObject([
      { action: "accept", questId: 8325, reason: "no_reply" },
    ]);
    logQuest(8325, 0);
    expect(runtime.snapshot().unresolved).toEqual([]);
  });
});
