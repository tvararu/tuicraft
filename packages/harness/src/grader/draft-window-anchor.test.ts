import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { scratchDir } from "@peon/core/test-support/scratch";
import { observedChecks } from "#harness/grader/draft-fill";
import type { CheckEvidence, ScenarioCheck } from "#harness/grader/scenarios";

const T0 = 1_790_000_000_000;

const row = (
  seq: number,
  event: string,
  data: Record<string, unknown>,
  at: number,
) => JSON.stringify({ data, event, seq, text: event, ts: T0 + at });

async function draft(lines: string[], evidence: CheckEvidence) {
  const dir = scratchDir("window-anchor");
  await writeFile(`${dir}/gamelog.jsonl`, `${lines.join("\n")}\n`);
  const check: ScenarioCheck = {
    evidence,
    expect: "windowed",
    id: "windowed",
    source: "game_log",
  };
  const [filled] = await observedChecks(dir, [check], ["stop", "resume"]);
  return filled;
}

describe("event-anchored windows", () => {
  const events = ["lfg/queued"];
  const leader = (seq: number, at: number) =>
    row(seq, "raid/roster", { change: "leader" }, at);
  const anchored: CheckEvidence = {
    events,
    window: { after: { data: { change: "leader" }, event: "raid/roster" } },
  };

  test("only rows after the first matching anchor row count", async () => {
    const lines = [
      row(1, "lfg/queued", { updateType: 5 }, 1000),
      row(2, "raid/roster", { change: "converted" }, 2000),
      leader(3, 3000),
      row(4, "lfg/queued", { updateType: 5 }, 4000),
      leader(5, 5000),
    ];
    const filled = await draft(lines, anchored);
    expect(filled?.observed).toMatchObject({ count: 1 });
    expect(filled?.ref).toBe("gamelog.jsonl:4");
  });

  test("the anchor row itself is outside its own window", async () => {
    const filled = await draft([leader(1, 3000)], {
      events: ["raid/roster"],
      window: { after: { event: "raid/roster" } },
    });
    expect(filled?.observed).toMatchObject({ count: 0 });
  });

  test("an anchor that never appears leaves the window unmet", async () => {
    const filled = await draft(
      [row(1, "lfg/queued", { updateType: 5 }, 1000)],
      {
        ...anchored,
        window: {
          after: { data: { change: "leader" }, event: "raid/roster" },
          max: 5,
        },
      },
    );
    expect(filled?.met).toBe(false);
    expect(filled?.ref).toBeUndefined();
  });

  test("an anchor window ignores afterMs and starts after the anchor", async () => {
    const lines = [
      leader(1, 3000),
      row(2, "lfg/queued", { updateType: 5 }, 4000),
      row(3, "lfg/queued", { updateType: 5 }, 9000),
    ];
    const filled = await draft(lines, {
      events,
      window: { after: { event: "raid/roster" }, afterMs: 5000 },
    });
    expect(filled?.observed).toMatchObject({ count: 2 });
    expect(filled?.ref).toBe("gamelog.jsonl:2");
  });
});
