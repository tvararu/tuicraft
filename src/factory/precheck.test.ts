import { describe, expect, test } from "bun:test";
import { paces } from "factory/config";
import type { Issue, LabelEvent, Pr } from "factory/github";
import {
  decideMerger,
  decideQa,
  decideReviewer,
  decideWorker,
  inScope,
} from "factory/precheck";

const pickWork = (issues: Issue[]) => decideWorker(issues, paces.default.wip);
const pickReview = (issues: Issue[]) =>
  decideReviewer(issues, paces.default.reviewing);

const theo: LabelEvent = {
  actor: "tvararu",
  at: "2026-09-25T10:00:00Z",
  label: "ready",
};
const bot: LabelEvent = {
  actor: "OpenHubris",
  at: "2026-09-25T11:00:00Z",
  label: "ready",
};

function issue(
  number: number,
  labels: string[],
  extra: Partial<Issue> = {},
): Issue {
  const base = {
    author: "OpenHubris",
    blockers: [],
    events: [theo],
    prs: [],
    title: `issue ${number}`,
  };
  return { labels, number, ...base, ...extra };
}

function pr(extra: Partial<Pr> = {}): Pr {
  const statuses = [
    { name: "factory/ci", state: "SUCCESS" },
    { name: "factory/review", state: "SUCCESS" },
  ];
  const base = {
    branch: "factory/1-x",
    draft: false,
    head: "abc",
    number: 100,
    state: "OPEN",
  };
  return { ...base, decision: "APPROVED", statuses, ...extra };
}

describe("scope rule", () => {
  test("latest ready actor wins", () => {
    expect(inScope(issue(1, ["ready"], { events: [bot, theo] }))).toBe(true);
    expect(inScope(issue(1, ["ready"], { events: [theo, bot] }))).toBe(false);
  });

  test("ready never added by pm is out", () => {
    expect(inScope(issue(1, ["ready"], { events: [] }))).toBe(false);
  });

  test("other label events do not affect the ready actor", () => {
    const events = [theo, { ...bot, label: "agent:rework" }];
    expect(inScope(issue(1, ["agent:rework"], { events }))).toBe(true);
  });

  test("rework with ready removed qualifies via history", () => {
    expect(inScope(issue(1, ["agent:rework"]))).toBe(true);
  });

  test("needs ready or rework label now", () => {
    expect(inScope(issue(1, ["agent:review"]))).toBe(false);
  });

  test("author is irrelevant", () => {
    expect(
      inScope(issue(1, ["ready"], { author: "tvararu", events: [bot] })),
    ).toBe(false);
    expect(inScope(issue(1, ["ready"], { author: "stranger" }))).toBe(true);
  });
});

describe("worker", () => {
  test("picks an in-scope issue", () => {
    expect(pickWork([issue(7, ["ready"])])).toEqual({
      ok: true,
      out: { issue: 7 },
    });
  });

  test("skips issues with an open blocker", () => {
    const blocked = issue(1, ["ready"], { blockers: ["CLOSED", "OPEN"] });
    const done = issue(2, ["ready"], { blockers: ["CLOSED"] });
    expect(pickWork([blocked, done])).toEqual({
      ok: true,
      out: { issue: 2 },
    });
    expect(pickWork([blocked]).ok).toBe(false);
  });

  test("skips issues already claimed", () => {
    const claimed = [
      "agent:working",
      "agent:review",
      "agent:reviewing",
      "agent:merging",
      "agent:landing",
    ];
    for (const label of claimed)
      expect(pickWork([issue(1, ["ready", label])]).ok).toBe(false);
  });

  test("pm ready overrides needs:pm", () => {
    expect(pickWork([issue(1, ["ready", "needs:pm"])])).toEqual({
      ok: true,
      out: { issue: 1 },
    });
  });

  test("needs:pm waits without a pm ready", () => {
    const bots = issue(1, ["ready", "needs:pm"], { events: [theo, bot] });
    expect(pickWork([bots]).ok).toBe(false);
    expect(pickWork([issue(2, ["needs:pm"])]).ok).toBe(false);
    expect(pickWork([issue(3, ["agent:rework", "needs:pm"])]).ok).toBe(false);
  });

  test("respects the wip cap", () => {
    const one = [issue(1, ["agent:working"]), issue(2, ["ready"])];
    const two = [issue(3, ["agent:working"]), ...one];
    expect(decideWorker(one, 2)).toEqual({ ok: true, out: { issue: 2 } });
    expect(decideWorker(two, 2)).toEqual({ ok: false, why: "wip 2/2" });
    expect(decideWorker(two, 3)).toEqual({ ok: true, out: { issue: 2 } });
  });

  test("orders by priority label then oldest number", () => {
    const issues = [
      issue(5, ["ready"]),
      issue(9, ["ready", "p2"]),
      issue(8, ["ready", "p1"]),
      issue(4, ["ready"]),
    ];
    expect(pickWork(issues)).toEqual({ ok: true, out: { issue: 8 } });
    expect(pickWork(issues.slice(0, 2))).toEqual({
      ok: true,
      out: { issue: 9 },
    });
    expect(pickWork([issue(5, ["ready"]), issue(4, ["ready"])])).toEqual({
      ok: true,
      out: { issue: 4 },
    });
  });
});

describe("reviewer", () => {
  test("picks a review issue with an open non-draft pr", () => {
    const issues = [issue(3, ["agent:review"], { prs: [pr({ number: 42 })] })];
    expect(pickReview(issues)).toEqual({
      ok: true,
      out: { issue: 3, pr: 42 },
    });
  });

  test("skips claimed reviews, drafts, closed and missing prs", () => {
    const issues = [
      issue(1, ["agent:review", "agent:reviewing"], { prs: [pr()] }),
      issue(2, ["agent:review"], { prs: [pr({ draft: true })] }),
      issue(3, ["agent:review"], { prs: [pr({ state: "MERGED" })] }),
      issue(4, ["agent:review"]),
    ];
    expect(pickReview(issues).ok).toBe(false);
  });

  test("stops at the reviews-in-flight cap", () => {
    const waiting = issue(9, ["agent:review"], { prs: [pr({ number: 90 })] });
    const inFlight = [1, 2].map((n) => issue(n, ["agent:reviewing"]));
    expect(decideReviewer([...inFlight, waiting], 3)).toEqual({
      ok: true,
      out: { issue: 9, pr: 90 },
    });
    const full = [...inFlight, issue(3, ["agent:reviewing"]), waiting];
    expect(decideReviewer(full, 3)).toEqual({
      ok: false,
      why: "reviewing 3/3",
    });
  });
});

describe("merger", () => {
  test("picks an approved pr with both statuses green", () => {
    const issues = [issue(4, ["agent:merging"], { prs: [pr({ number: 50 })] })];
    expect(decideMerger(issues, true)).toEqual({
      ok: true,
      out: { approval: "required", issue: 4, pr: 50 },
    });
  });

  test("requires approval when the pm gate is on", () => {
    for (const decision of [null, "REVIEW_REQUIRED", "CHANGES_REQUESTED"]) {
      expect(
        decideMerger(
          [issue(4, ["agent:merging"], { prs: [pr({ decision })] })],
          true,
        ).ok,
      ).toBe(false);
    }
  });

  test("lands without approval when the pm gate is off", () => {
    const issues = [
      issue(4, ["agent:merging"], {
        prs: [pr({ decision: null, number: 50 })],
      }),
    ];
    expect(decideMerger(issues, false)).toEqual({
      ok: true,
      out: { approval: "not-required", issue: 4, pr: 50 },
    });
  });

  test("requires both factory statuses to succeed", () => {
    const missing = pr({
      statuses: [{ name: "factory/ci", state: "SUCCESS" }],
    });
    const pending = pr({
      statuses: [
        ...missing.statuses,
        { name: "factory/review", state: "PENDING" },
      ],
    });
    for (const candidate of [missing, pending, pr({ statuses: [] })]) {
      expect(
        decideMerger([issue(4, ["agent:merging"], { prs: [candidate] })]).ok,
      ).toBe(false);
    }
  });

  test("landing lock blocks every merge", () => {
    const issues = [
      issue(4, ["agent:merging"], { prs: [pr()] }),
      issue(6, ["agent:landing"]),
    ];
    expect(decideMerger(issues)).toEqual({ ok: false, why: "#6 is landing" });
  });
});

describe("qa", () => {
  test("runs when main moved or nothing is stored", () => {
    expect(decideQa("a".repeat(40), null)).toEqual({
      ok: true,
      out: { sha: "a".repeat(40) },
    });
    expect(decideQa("a".repeat(40), "b".repeat(40)).ok).toBe(true);
    expect(decideQa("a".repeat(40), "a".repeat(40)).ok).toBe(false);
  });
});
