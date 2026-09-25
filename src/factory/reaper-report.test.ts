import { describe, expect, test } from "bun:test";
import {
  type Held,
  heldNames,
  planReport,
  reportBody,
} from "factory/reaper-report";

describe("planReport", () => {
  const a: Held = {
    ageHours: 14,
    archive: "/x/alpha.patch",
    name: "alpha",
    owner: "theo",
    reason: "dirty",
  };
  const b: Held = {
    ageHours: 4,
    archive: null,
    name: "beta",
    owner: "reaper:worker",
    reason: "unlanded-commits",
  };
  const issue = { body: reportBody([a]), labels: ["needs:pm"], number: 7 };
  const today = "2026-09-25";

  test("the body round-trips the held names", () => {
    expect(heldNames(reportBody([a, b]))).toEqual(["alpha", "beta"]);
    expect(heldNames(reportBody([]))).toEqual([]);
  });

  test("nothing to do with no issue and nothing held", () => {
    expect(
      planReport({ held: [], issue: null, lastCommentDay: null, today }),
    ).toBeNull();
  });

  test("the first held item creates the issue", () => {
    expect(
      planReport({ held: [a], issue: null, lastCommentDay: null, today })
        ?.create,
    ).toBe(true);
  });

  test("same list on the same day changes nothing", () => {
    const plan = planReport({ held: [a], issue, lastCommentDay: today, today });
    expect(plan).toEqual({
      body: issue.body,
      comment: null,
      create: false,
      edit: false,
      label: null,
    });
  });

  test("a new item edits the body and comments about it", () => {
    const plan = planReport({
      held: [a, b],
      issue,
      lastCommentDay: today,
      today,
    });
    expect(plan?.edit).toBe(true);
    expect(plan?.comment).toContain("`beta`");
    expect(plan?.comment).not.toContain("`alpha`");
  });

  test("an unchanged list gets one summary per new day", () => {
    expect(
      planReport({ held: [a], issue, lastCommentDay: "2026-09-24", today })
        ?.comment,
    ).toContain("Daily summary");
  });

  test("an emptied list drops the label without commenting", () => {
    const plan = planReport({
      held: [],
      issue,
      lastCommentDay: "2026-09-24",
      today,
    });
    expect(plan).toMatchObject({ comment: null, edit: true, label: "remove" });
  });

  test("a held list re-adds a missing label", () => {
    expect(
      planReport({
        held: [a],
        issue: { ...issue, labels: [] },
        lastCommentDay: today,
        today,
      })?.label,
    ).toBe("add");
  });
});
