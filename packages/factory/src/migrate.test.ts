import { describe, expect, test } from "bun:test";
import { labelNames, planMigration, statusForLabels } from "#factory/migrate";

describe("statusForLabels", () => {
  test("maps each legacy workflow label to its column", () => {
    expect(statusForLabels(["ready"])).toBe("ready");
    expect(statusForLabels(["agent:rework"])).toBe("ready");
    expect(statusForLabels(["agent:working", "ready"])).toBe("in-progress");
    expect(statusForLabels(["agent:review"])).toBe("in-review");
    expect(statusForLabels(["agent:landing", "ready"])).toBe("in-review");
    expect(statusForLabels(["needs:pm", "p1"])).toBe("blocked");
    expect(statusForLabels(["qa:found", "p1"])).toBeNull();
  });

  test("a worker lock beats everything, a question beats review", () => {
    expect(statusForLabels(["needs:pm", "agent:working"])).toBe("in-progress");
    expect(statusForLabels(["needs:pm", "agent:merging"])).toBe("blocked");
  });

  test("an answered question with ready is ready", () => {
    expect(statusForLabels(["needs:pm", "ready"])).toBe("ready");
  });

  test("an issue with no status-bearing label keeps its status", () => {
    expect(statusForLabels([])).toBeNull();
    expect(statusForLabels(["bug"])).toBeNull();
  });
});

describe("planMigration", () => {
  test("sets status, removes labels, then deletes repo labels", () => {
    const steps = planMigration(
      [
        { card: null, labels: ["ready", "p1", "bug"], number: 5 },
        {
          card: { item: "PVTI_6", status: "backlog" },
          labels: ["agent:working"],
          number: 6,
        },
        { card: null, labels: [], number: 7 },
      ],
      ["bug", "p1", "ready", "agent:working"],
    );
    expect(steps).toEqual([
      { issue: 5, item: null, kind: "status", status: "ready" },
      { issue: 5, kind: "unlabel", labels: ["ready", "p1"] },
      { issue: 6, item: "PVTI_6", kind: "status", status: "in-progress" },
      { issue: 6, kind: "unlabel", labels: ["agent:working"] },
      { issue: 7, item: null, kind: "status", status: "backlog" },
      { kind: "delete-label", label: "ready" },
      { kind: "delete-label", label: "agent:working" },
      { kind: "delete-label", label: "p1" },
    ]);
  });

  test("a card already in the mapped column only loses its labels", () => {
    const card = { item: "PVTI_8", status: "in-review" as const };
    expect(
      planMigration([{ card, labels: ["agent:review"], number: 8 }], []),
    ).toEqual([{ issue: 8, kind: "unlabel", labels: ["agent:review"] }]);
  });

  test("an already migrated repo needs nothing", () => {
    const card = { item: "PVTI_9", status: "ready" as const };
    expect(
      planMigration([{ card, labels: ["bug"], number: 9 }], ["bug"]),
    ).toEqual([]);
  });

  test("leaves the qa label and Triage cards alone", () => {
    const card = { item: "PVTI_10", status: "triage" as const };
    expect(
      planMigration([{ card, labels: ["qa"], number: 10 }], ["qa"]),
    ).toEqual([]);
  });
});

describe("labelNames", () => {
  test("a repo with no labels lists none", () => {
    expect(labelNames("")).toEqual([]);
    expect(labelNames("\n")).toEqual([]);
  });

  test("reads the names gh label list prints as JSON", () => {
    expect(labelNames('[{"name":"qa"},{"name":"ready"}]\n')).toEqual([
      "qa",
      "ready",
    ]);
  });

  test("an empty listing plans no label deletions", () => {
    const issues = [{ card: null, labels: ["ready"], number: 11 }];
    expect(planMigration(issues, labelNames(""))).toEqual([
      { issue: 11, item: null, kind: "status", status: "ready" },
      { issue: 11, kind: "unlabel", labels: ["ready"] },
    ]);
    expect(
      planMigration(issues, labelNames('[{"name":"ready"}]')),
    ).toContainEqual({ kind: "delete-label", label: "ready" });
  });
});
