import { describe, expect, jest, test } from "bun:test";
import { dispatchCommand, type EventEntry } from "daemon/commands";
import { parseIpcCommand } from "daemon/parse";
import { RingBuffer } from "lib/ring-buffer";
import { attachControl, createMockSocket } from "test/commands-fixtures";
import { createMockHandle } from "test/mock-handle";
import type { NamedTrainerState } from "wow";

const ARENA = 0xf130_003b_b400_49een;
const learned: NamedTrainerState = {
  coinage: 91,
  lastOutcome: {
    action: "train",
    coinageAfter: 91,
    learnedSpells: [1243],
    moneyDelta: -9,
    observedAt: 2000,
    reason: undefined,
    request: {
      action: "train",
      coinageBefore: 100,
      cost: 9,
      guid: ARENA,
      learnedBefore: [],
      requestedAt: 1000,
      spellId: 1243,
      succeeded: true,
    },
    status: "confirmed",
  },
  level: 1,
  offer: {
    greeting: "Hello, priest!",
    guid: ARENA,
    receivedAt: 900,
    spells: [
      {
        cost: 9,
        firstRank: 0,
        name: "Power Word: Fortitude",
        rank: "Rank 1",
        requiredLevel: 1,
        requiredSkill: 0,
        requiredSkillValue: 0,
        requiredSpells: [0, 0, 0],
        spellId: 1243,
        state: "known",
        talentPointCost: 0,
        usable: 0,
      },
    ],
    trainerType: 0,
  },
  pending: undefined,
};

async function run(type: "trainer" | "trainer_json") {
  const socket = createMockSocket();
  const handle = Object.assign(createMockHandle(), {
    getTrainerState: async () => learned,
  });
  await dispatchCommand(
    { type },
    {
      cleanup: jest.fn(),
      events: new RingBuffer<EventEntry>(10),
      handle: attachControl(handle),
      socket,
    },
  );
  return socket.written();
}

describe("trainer IPC boundary", () => {
  test("parses trainer verbs and rejects bad operands", () => {
    expect(parseIpcCommand("OPEN_TRAINER 0xf130003bb40049ee")).toEqual({
      guid: ARENA,
      type: "open_trainer",
    });
    expect(parseIpcCommand("TRAIN 1243")).toEqual({
      spellId: 1243,
      type: "train",
    });
    expect(parseIpcCommand("TRAINER_JSON")).toEqual({ type: "trainer_json" });
    for (const line of ["OPEN_TRAINER 0", "TRAIN 0", "TRAIN", "TRAIN 1 2"])
      expect(parseIpcCommand(line)?.type).toBe("invalid");
  });

  test("text names each spell with its state and the confirmed purchase", async () => {
    expect((await run("trainer")).split("\n")).toEqual([
      "Trainer: 0xf130003bb40049ee (class), 1 spells, character level 1",
      "Spell 1243 Power Word: Fortitude (Rank 1): known, 9 copper, level 1",
      "Last: train 1243 for 9 copper: confirmed, learned 1243, -9 copper (coinage 100 -> 91)",
      "Carried coinage: 91",
      "",
      "",
    ]);
  });

  test("JSON keeps the trainer GUID as hex", async () => {
    const state = JSON.parse(await run("trainer_json"));
    expect(state.offer.guid).toBe("0xf130003bb40049ee");
    expect(state.lastOutcome.learnedSpells).toEqual([1243]);
  });
});
