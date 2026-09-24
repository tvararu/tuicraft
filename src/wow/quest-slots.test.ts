import { describe, expect, test } from "bun:test";
import { questLogChanges, type QuestLog } from "wow/quest-slots";

function log(entries: [number, number][]): QuestLog {
  const slots = Array.from({ length: 25 }, (_, slot) => ({
    slot,
    questId: entries[slot]?.[0] ?? 0,
    flags: entries[slot]?.[1] ?? 0,
    counters: [0, 0, 0, 0] as [number, number, number, number],
    expiresAtSeconds: 0,
  }));
  return { complete: true, slots };
}

describe("questLogChanges", () => {
  test("reports accepted, completed and removed quests in order", () => {
    expect(questLogChanges(log([[7, 0]]), log([[9, 1]]))).toEqual([
      { type: "accepted", questId: 9 },
      { type: "completed", questId: 9 },
      { type: "removed", questId: 7 },
    ]);
  });

  test("reports a flag change as completion plus progress", () => {
    expect(questLogChanges(log([[7, 0]]), log([[7, 1]]))).toEqual([
      { type: "completed", questId: 7 },
      { type: "progress", questId: 7 },
    ]);
  });
});
