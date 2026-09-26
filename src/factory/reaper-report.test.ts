import { describe, expect, test } from "bun:test";
import {
  type Held,
  heldName,
  planReport,
  planStray,
  type ReportIssue,
  reportBody,
  reportTitle,
  strayBody,
  strayName,
  strayTitle,
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
  const issueFor = (h: Held, number: number): ReportIssue => ({
    body: reportBody(h),
    number,
    title: reportTitle(h),
  });

  test("the title round-trips the worktree name", () => {
    expect(heldName(reportTitle(a))).toBe("alpha");
    expect(heldName("Replace the permanent reaper report issue")).toBeNull();
  });

  test("the body names the worktree, reason, archive and a fix", () => {
    const body = reportBody(a);
    expect(body).toContain("@tvararu");
    expect(body).toContain("`alpha`");
    expect(body).toContain("dirty");
    expect(body).toContain("/x/alpha.patch");
    expect(body).toContain("What to do:");
  });

  test("a newly held worktree opens one issue", () => {
    expect(planReport([a], [])).toEqual({
      close: [],
      create: [{ body: reportBody(a), title: reportTitle(a) }],
      update: [],
    });
  });

  test("a worktree still held the same way changes nothing", () => {
    expect(planReport([{ ...a, ageHours: 40 }], [issueFor(a, 7)])).toEqual({
      close: [],
      create: [],
      update: [],
    });
  });

  test("a changed reason edits the existing issue instead of opening one", () => {
    const moved: Held = { ...a, reason: "over-cap-dirty" };
    expect(planReport([moved], [issueFor(a, 7)])).toEqual({
      close: [],
      create: [],
      update: [
        { body: reportBody(moved), number: 7, title: reportTitle(moved) },
      ],
    });
  });

  test("a worktree no longer held closes its issue", () => {
    const plan = planReport([b], [issueFor(a, 7), issueFor(b, 8)]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.close.map((c) => c.number)).toEqual([7]);
    expect(plan.close[0]?.comment).toContain("`alpha`");
  });

  test("issues without a reaper title are left alone", () => {
    const other = { body: "", number: 9, title: "Factory: reaper report" };
    expect(planReport([], [other])).toEqual({
      close: [],
      create: [],
      update: [],
    });
  });
});

describe("planStray", () => {
  const dirty: ReportIssue = {
    body: "",
    number: 7,
    title: "Reaper: alpha held (dirty)",
  };
  const stray = (value: string, number: number): ReportIssue => ({
    body: strayBody(value),
    number,
    title: strayTitle(),
  });

  test("the body gives the value and the unset command", () => {
    const body = strayBody("/wt/run-26");
    expect(body).toContain("`/wt/run-26`");
    expect(body).toContain("config --unset core.worktree");
  });

  test("opens one issue and leaves other held reports open", () => {
    expect(planStray("/wt/run-26", [dirty])).toEqual({
      close: [],
      create: [{ body: strayBody("/wt/run-26"), title: strayTitle() }],
      update: [],
    });
  });

  test("an unchanged value changes nothing; a new value edits the issue", () => {
    const open = stray("/wt/run-26", 9);
    expect(planStray("/wt/run-26", [open]).update).toEqual([]);
    expect(planStray("/wt/run-27", [open])).toEqual({
      close: [],
      create: [],
      update: [
        { body: strayBody("/wt/run-27"), number: 9, title: strayTitle() },
      ],
    });
  });

  test("the next normal pass closes it", () => {
    const plan = planReport([], [stray("/wt/run-26", 9)]);
    expect(plan.close.map((c) => c.number)).toEqual([9]);
    expect(heldName(strayTitle())).toBe(strayName);
  });
});
