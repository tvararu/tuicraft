import { describe, expect, test } from "bun:test";
import { waitUntil } from "test/live-helpers";
import { must } from "test/must";
import { authHandshake } from "wow/auth";
import { type WorldHandle, worldSession } from "wow/client";
import type { QuestEvent } from "wow/quests";

const config1 = {
  account: Bun.env["WOW_ACCOUNT_1"] ?? "",
  character: Bun.env["WOW_CHARACTER_1"] ?? "",
  host: Bun.env["WOW_HOST"] ?? "t1",
  language: Number.parseInt(Bun.env["WOW_LANGUAGE"] ?? "1", 10),
  password: Bun.env["WOW_PASSWORD_1"] ?? "",
  port: Number.parseInt(Bun.env["WOW_PORT"] ?? "3724", 10),
};

const ERONA = 15_278;
const QUEST = 8325;
const SUNSTRIDER_START = ".go xyz 10349.6 -6357.29 33.4026 530";
const OUT_OF_REACH = ".go xyz 10382 -6379.56 37.69 530";

async function reachErona(handle: WorldHandle) {
  await waitUntil(() => handle.getQuestState().log.complete);
  handle.sendWhisper(config1.character, SUNSTRIDER_START);
  await waitUntil(() =>
    handle.getNearbyEntities().some((e) => e.entry === ERONA),
  );
  await Bun.sleep(2000);
  return must(handle.getNearbyEntities().find((e) => e.entry === ERONA));
}

describe("quest dialog", () => {
  test("auto-accept quest enters the log on select, then abandons", async () => {
    const handle = await worldSession(config1, await authHandshake(config1));
    const events: QuestEvent[] = [];
    const unsubscribe = handle.onQuestEvent((event) => events.push(event));
    const logged = () =>
      handle.getQuestState().log.slots.find((slot) => slot.questId === QUEST)
        ?.slot;
    try {
      const erona = await reachErona(handle);
      const existing = logged();
      if (existing !== undefined) {
        handle.abandonQuest(existing);
        await waitUntil(() => logged() === undefined);
      }

      handle.talk(erona.guid);
      await waitUntil(() => handle.getQuestState().dialog?.kind === "gossip");
      handle.selectQuest(QUEST);
      await waitUntil(() => logged() !== undefined);
      expect(
        events.some((e) => e.type === "accepted" && e.questId === QUEST),
      ).toBe(true);
      expect(handle.getQuestState().dialog?.kind).toBe("details");
      expect(() => handle.acceptQuest()).toThrow("quest_already_in_log");

      handle.cancelInteraction();
      await waitUntil(() => handle.getQuestState().pending === undefined);
      handle.abandonQuest(must(logged()));
      await waitUntil(() => logged() === undefined);
      expect(
        events.some((e) => e.type === "removed" && e.questId === QUEST),
      ).toBe(true);
      expect(handle.getQuestState().lastReward).toBeUndefined();
    } finally {
      unsubscribe();
      handle.close();
      await handle.closed;
    }
  }, 60_000);

  test("a cancelled unanswered talk stays unresolved", async () => {
    const handle = await worldSession(config1, await authHandshake(config1));
    try {
      const erona = await reachErona(handle);
      handle.sendWhisper(config1.character, OUT_OF_REACH);
      await Bun.sleep(3000);
      handle.talk(erona.guid);
      await Bun.sleep(3000);
      expect(handle.getQuestState().pending?.action).toBe("talk");
      handle.cancelInteraction();
      await waitUntil(() => handle.getQuestState().pending === undefined);
      handle.cancelInteraction();
      await waitUntil(() => handle.getQuestState().pending === undefined);
      expect(handle.getQuestState().dialog).toBeUndefined();
      expect(handle.getQuestState().unresolved).toMatchObject([
        { action: "talk", guid: erona.guid },
      ]);
    } finally {
      handle.close();
      await handle.closed;
    }
  }, 60_000);
});
