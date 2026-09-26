import { describe, expect, test } from "bun:test";
import {
  type Draft,
  type Held,
  heldName,
  issueOf,
  legacyReports,
  planDrafts,
  planStray,
  reportBody,
  reportTitle,
  strayBody,
  strayName,
  strayTitle,
} from "#factory/reaper-report";

const a: Held = {
  ageHours: 14,
  archive: "/x/alpha.patch",
  issue: null,
  name: "alpha",
  owner: "maintainer",
  reason: "dirty",
};
const b: Held = {
  ageHours: 4,
  archive: null,
  issue: 103,
  name: "beta",
  owner: "reaper:worker",
  reason: "unlanded-commits",
};
const draftFor = (h: Held, n: number): Draft => ({
  body: reportBody(h),
  id: `DI_${n}`,
  item: `PVTI_${n}`,
  status: "blocked",
  title: reportTitle(h),
});
const empty = { create: [], delete: [], update: [] };

describe("report text", () => {
  test("the title round-trips the worktree name", () => {
    expect(heldName(reportTitle(a))).toBe("alpha");
    expect(heldName("Replace the permanent reaper report issue")).toBeNull();
  });

  test("the body names the hold and a fix without mentioning anyone", () => {
    const body = reportBody(a);
    expect(body).not.toContain("@");
    expect(body).toContain("`alpha`");
    expect(body).toContain("/x/alpha.patch");
    expect(body).toContain("What to do:");
    expect(body).toContain("deletes this card");
    expect(body).not.toContain("- Issue:");
    expect(body).not.toContain("back to Ready");
  });

  test("a branch that names an issue links it", () => {
    expect(issueOf("refs/heads/factory/103-factory-project-board")).toBe(103);
    expect(issueOf("OpenHubris/auto-work-run-177")).toBeNull();
    expect(reportBody(b)).toContain("- Issue: #103");
    expect(reportBody(b)).toContain("move #103 back to Ready");
  });
});

describe("planDrafts", () => {
  test("a newly held worktree creates one draft", () => {
    expect(planDrafts([a, { ...a, reason: "over-cap-dirty" }], [])).toEqual({
      ...empty,
      create: [{ body: reportBody(a), title: reportTitle(a) }],
    });
  });

  test("a worktree still held the same way changes nothing", () => {
    const draft = { ...draftFor(a, 1), body: `${reportBody(a)}\n` };
    expect(planDrafts([{ ...a, ageHours: 40 }], [draft])).toEqual(empty);
  });

  test("a changed reason or body edits the draft in place", () => {
    const moved: Held = { ...a, reason: "over-cap-dirty" };
    expect(planDrafts([moved], [draftFor(a, 1)]).update).toEqual([
      {
        body: reportBody(moved),
        content: true,
        id: "DI_1",
        item: "PVTI_1",
        status: false,
        title: reportTitle(moved),
      },
    ]);
    const linked = planDrafts([{ ...a, issue: 7 }], [draftFor(a, 1)]);
    expect(linked.update[0]?.body).toContain("- Issue: #7");
  });

  test("a draft moved out of Blocked goes back without an edit", () => {
    const draft = { ...draftFor(a, 1), status: "ready" as const };
    expect(planDrafts([a], [draft]).update).toMatchObject([
      { content: false, item: "PVTI_1", status: true },
    ]);
  });

  test("drafts for released worktrees and duplicates are deleted", () => {
    const plan = planDrafts(
      [b],
      [draftFor(a, 1), draftFor(b, 2), draftFor(b, 3)],
    );
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.delete.map((d) => d.item)).toEqual(["PVTI_1", "PVTI_3"]);
  });

  test("drafts without a reaper title are left alone", () => {
    const other = { ...draftFor(a, 1), title: "Try sizes on cards" };
    expect(planDrafts([], [other])).toEqual(empty);
  });
});

describe("planStray", () => {
  const stray = (value: string, n: number): Draft => ({
    body: strayBody(value),
    id: `DI_${n}`,
    item: `PVTI_${n}`,
    status: "blocked",
    title: strayTitle(),
  });

  test("the body gives the value and the unset command", () => {
    const body = strayBody("/wt/run-26");
    expect(body).toContain("`/wt/run-26`");
    expect(body).toContain("config --unset core.worktree");
    expect(body).not.toContain("@");
  });

  test("creates one draft and keeps other hold drafts", () => {
    expect(planStray("/wt/run-26", [draftFor(a, 1)])).toEqual({
      ...empty,
      create: [{ body: strayBody("/wt/run-26"), title: strayTitle() }],
    });
  });

  test("an unchanged value changes nothing; a new value edits the draft", () => {
    const card = stray("/wt/run-26", 9);
    expect(planStray("/wt/run-26", [card])).toEqual(empty);
    expect(planStray("/wt/run-27", [card]).update).toMatchObject([
      { body: strayBody("/wt/run-27"), content: true, item: "PVTI_9" },
    ]);
  });

  test("the next normal pass deletes it", () => {
    const plan = planDrafts([], [stray("/wt/run-26", 9)]);
    expect(plan.delete.map((d) => d.item)).toEqual(["PVTI_9"]);
    expect(heldName(strayTitle())).toBe(strayName);
  });
});

describe("legacyReports", () => {
  test("only the bot's reaper issues are closed", () => {
    const issue = (number: number, author: string, title: string) => ({
      author,
      labels: [],
      number,
      title,
    });
    const issues = [
      issue(1, "OpenHubris", reportTitle(a)),
      issue(2, "tvararu", reportTitle(b)),
      issue(3, "OpenHubris", "Factory: reaper report"),
    ];
    expect(legacyReports(issues)).toEqual([1]);
  });
});
