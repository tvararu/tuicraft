import { describe, expect, test } from "bun:test";
import { createMockHandle } from "test/mock-handle";
import { formatQuestEventText, formatQuestState } from "ui/format-quests";
import type {
  QuestEvent,
  QuestLogSlot,
  QuestQuery,
  QuestRewards,
  QuestState,
} from "wow";

const GIVER = 0xf130003bae004980n;
const base = createMockHandle().getQuestState();

const noRewards: QuestRewards = {
  arenaPoints: 0,
  choices: [],
  experience: 0,
  factions: [],
  honor: 0,
  honorMultiplier: 0,
  items: [],
  money: 0,
  reputationMask: 0,
  spellCastId: 0,
  spellId: 0,
  talents: 0,
  titleId: 0,
};

function slot(n: number, questId = 0, flags = 0, counters = [0, 0, 0, 0]) {
  return {
    counters,
    expiresAtSeconds: 0,
    flags,
    questId,
    slot: n,
  } as QuestLogSlot;
}

function log(...held: QuestLogSlot[]): QuestState["log"] {
  const slots = Array.from({ length: 25 }, (_, n) => slot(n));
  for (const entry of held) slots[entry.slot] = entry;
  return { complete: true, slots };
}

const known8325 = {
  data: {
    questId: 8325,
    targets: [{ count: 8 }, { count: 0 }, { count: 0 }, { count: 0 }],
    title: "Reclaiming Sunstrider Isle",
  },
  questId: 8325,
  receivedAt: 1,
  status: "known",
} as unknown as QuestQuery;

function state(overrides: Partial<QuestState>): QuestState {
  return { ...base, log: log(), ...overrides };
}

describe("text quests", () => {
  test("lists held quests with counts, not the 25 empty slots", () => {
    const output = formatQuestState(
      state({
        lastError: { at: 1, kind: "invalid", reason: 13 },
        lastReward: {
          arenaPoints: 0,
          at: 1,
          experience: 100,
          honor: 0,
          money: 30,
          questId: 8325,
          talents: 0,
        },
        log: log(slot(0, 8325, 0, [3, 0, 0, 0]), slot(1, 8326, 1)),
        queries: [known8325],
      }),
    );
    expect(output).toEqual([
      "Dialog: none",
      "Quest log: 2 quests",
      "Slot 0: quest 8325 Reclaiming Sunstrider Isle, in progress, 3/8",
      "Slot 1: quest 8326, complete",
      "Last error: invalid: already on that quest",
      "Last reward: 8325 Reclaiming Sunstrider Isle +100 XP +30 copper",
    ]);
  });

  test("counts carried quest items and lists unresolved requests", () => {
    const output = formatQuestState(
      state({
        items: [
          { carried: 5, itemId: 20_797, questId: 8326, required: 8 },
          { carried: undefined, itemId: 20_798, questId: 8326, required: 2 },
        ],
        log: log(slot(0, 8326)),
        unresolved: [
          { action: "accept", at: 1, questId: 8326, reason: "cancelled" },
          { action: "talk", at: 2, guid: GIVER, reason: "no_reply" },
        ],
      }),
    );
    expect(output).toEqual([
      "Dialog: none",
      "Unresolved: accept 8326",
      "Unresolved: talk",
      "Quest log: 1 quests",
      "Slot 0: quest 8326, in progress, item 20797 5/8 item 20798 ?/2",
    ]);
  });

  test("shows a gossip dialog with options, quests and the next step", () => {
    const output = formatQuestState(
      state({
        dialog: {
          data: {
            guid: GIVER,
            menuId: 1,
            options: [
              {
                boxText: "",
                coded: 0,
                icon: 0,
                money: 0,
                optionIndex: 0,
                text: "Train me.",
              },
            ],
            quests: [
              {
                flags: 0,
                icon: 2,
                level: 4,
                questId: 8326,
                repeatable: 0,
                title: "Unfortunate Measures",
              },
            ],
            titleTextId: 0,
          },
          kind: "gossip",
        },
        log: { complete: false, slots: [] },
        pending: { action: "talk", at: 1, guid: GIVER, status: "unanswered" },
      }),
    );
    expect(output).toEqual([
      "Dialog: gossip from 0xf130003bae004980",
      "Option 0: Train me.",
      "Quest 8326 (level 4): Unfortunate Measures",
      "Next: tuicraft select-quest <id> or select-option <id>",
      "Request: talk unanswered",
      "Quest log: unknown",
    ]);
  });

  test("names required items and the verb that advances each turn-in step", () => {
    const requestItems = formatQuestState(
      state({
        dialog: {
          data: {
            closeOnCancel: 0,
            completionFlags: [3, 3, 3, 3],
            emote: 0,
            flags: 0,
            guid: GIVER,
            items: [{ count: 8, displayId: 1, itemId: 20_797 }],
            questId: 8326,
            requestText: "",
            requiredMoney: 0,
            suggestedPlayers: 0,
            title: "Unfortunate Measures",
            unknown: 0,
          },
          kind: "requestItems",
        },
      }),
    );
    expect(requestItems.slice(0, 3)).toEqual([
      "Dialog: requestItems from 0xf130003bae004980, quest 8326 Unfortunate Measures",
      "Required items: item 20797 x8",
      "Next: tuicraft request-reward",
    ]);
    const offer = formatQuestState(
      state({
        dialog: {
          data: {
            emotes: [],
            enableNext: 0,
            flags: 0,
            guid: GIVER,
            questId: 8326,
            rewards: {
              ...noRewards,
              choices: [
                { count: 1, displayId: 1, itemId: 20_991 },
                { count: 1, displayId: 1, itemId: 20_992 },
              ],
              experience: 250,
              money: 75,
            },
            rewardText: "",
            suggestedPlayers: 0,
            title: "Unfortunate Measures",
            unknownAfterHonorMultiplier: 0,
          },
          kind: "offer",
        },
      }),
    );
    expect(offer.slice(0, 5)).toEqual([
      "Dialog: offer from 0xf130003bae004980, quest 8326 Unfortunate Measures",
      "Reward choice 0: item 20991 x1",
      "Reward choice 1: item 20992 x1",
      "Rewards: 250 XP, 75 copper",
      "Next: tuicraft choose-reward <index> (0 without choices)",
    ]);
  });
});

test("an auto-accepted quest's details point at closing, not accepting", () => {
  const details = {
    activateAccept: 1,
    details: "",
    dividerGuid: 0n,
    emotes: [],
    flags: 0,
    guid: GIVER,
    objectives: "",
    questId: 8325,
    rewards: noRewards,
    suggestedPlayers: 0,
    title: "Reclaiming Sunstrider Isle",
    unknown: 0,
  };
  const next = (held: QuestState["log"], activateAccept: number) =>
    formatQuestState(
      state({
        dialog: { data: { ...details, activateAccept }, kind: "details" },
        log: held,
      }),
    )[1];
  expect(next(log(), 1)).toBe("Next: tuicraft accept-quest");
  expect(next(log(slot(0, 8325)), 1)).toBe(
    "Next: already in the quest log; tuicraft cancel-interaction closes the dialog",
  );
  expect(next(log(), 0)).toBe(
    "Next: accept not offered; tuicraft cancel-interaction",
  );
});

describe("quest read lines", () => {
  function event(overrides: Partial<QuestEvent>): string {
    return formatQuestEventText({
      source: "quest_log",
      state: state({ queries: [known8325] }),
      type: "log",
      ...overrides,
    });
  }

  test("append a bound or window detail", () => {
    expect(event({ detail: "no_reply", type: "expired" })).toBe(
      "[quest] expired no_reply",
    );
    expect(event({ detail: "trainer", type: "window" })).toBe(
      "[quest] window trainer",
    );
    expect(event({ detail: "unsupported_window:bank", type: "window" })).toBe(
      "[quest] window unsupported_window:bank",
    );
  });

  test("name the quest and its facts", () => {
    expect(event({ questId: 8325, type: "accepted" })).toBe(
      "[quest] accepted 8325 Reclaiming Sunstrider Isle",
    );
    expect(
      event({
        questId: 8325,
        state: state({
          log: log(slot(0, 8325, 0, [3, 0, 0, 0])),
          queries: [known8325],
        }),
        type: "progress",
      }),
    ).toBe("[quest] progress 8325 Reclaiming Sunstrider Isle: 3/8");
    expect(
      event({
        questId: 8325,
        source: "packet",
        state: state({
          lastProgress: {
            at: 1,
            data: {
              currentCount: 4,
              encodedNpcOrGoId: 15_274,
              guid: 1n,
              npcOrGoId: 15_274,
              questId: 8325,
              requiredCount: 8,
            },
            kind: "kill",
          },
          queries: [known8325],
        }),
        type: "progress",
      }),
    ).toBe(
      "[quest] progress 8325 Reclaiming Sunstrider Isle: creature 15274 4/8",
    );
    expect(
      event({
        questId: 8326,
        source: "inventory",
        state: state({
          lastProgress: {
            at: 1,
            bag: 255,
            carried: 3,
            itemId: 20_797,
            kind: "collect",
            pushed: 1,
            questId: 8326,
            required: 8,
            slot: 23,
            totalCount: 3,
          },
        }),
        type: "progress",
      }),
    ).toBe("[quest] progress 8326: item 20797 3/8");
  });

  test("carry reward amounts, error reasons and the next dialog step", () => {
    const reward = {
      arenaPoints: 0,
      at: 1,
      experience: 100,
      honor: 0,
      money: 30,
      questId: 8325,
      talents: 0,
    };
    expect(
      event({
        questId: 8325,
        source: "packet",
        state: state({ lastReward: reward, queries: [known8325] }),
        type: "rewarded",
      }),
    ).toBe(
      "[quest] rewarded 8325 Reclaiming Sunstrider Isle +100 XP +30 copper",
    );
    expect(
      event({
        source: "packet",
        state: state({ lastError: { at: 1, kind: "invalid", reason: 13 } }),
        type: "error",
      }),
    ).toBe("[quest] error invalid: already on that quest");
    expect(event({ type: "log" })).toBe("[quest] log");
    expect(
      event({
        questId: 8325,
        source: "request",
        state: state({
          lastIntent: { action: "selectQuest", at: 1, questId: 8325 },
          queries: [known8325],
        }),
        type: "intent",
      }),
    ).toBe("[quest] intent selectQuest 8325 Reclaiming Sunstrider Isle");
  });
});
