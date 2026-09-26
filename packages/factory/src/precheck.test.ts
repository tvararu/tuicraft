import { describe, expect, test } from "bun:test";
import { paces } from "#factory/config";
import type { Issue } from "#factory/github";
import { liveLandings } from "#factory/markers";
import {
  decideMerger,
  decideQa,
  decideReviewer,
  decideWorker,
  heldPicks,
} from "#factory/precheck";
import { ago, issue, marker, now, pr } from "#test-support/factory-fixtures";

const head = "d".repeat(40);
const pickWork = (issues: Issue[]) =>
  decideWorker(issues, paces.default.wip, now);
const pickReview = (issues: Issue[]) =>
  decideReviewer(issues, paces.default.reviewing, now);
const unreviewed = (extra = {}) =>
  pr({
    checked: head,
    head,
    statuses: [{ name: "signoff/ci", state: "SUCCESS" }],
    ...extra,
  });

describe("worker", () => {
  test("picks the oldest Ready card as fresh when it has no factory PR", () => {
    const issues = [
      issue(9, "ready"),
      issue(5, "ready"),
      issue(2, "backlog"),
      issue(4, "triage"),
      issue(3, "blocked"),
      issue(1, null),
    ];
    expect(pickWork(issues)).toEqual({
      ok: true,
      out: { issue: 5, mode: "fresh", reason: "fresh" },
    });
  });

  test("an open factory PR for the issue makes it a rework, with why", () => {
    const failed = [{ at: ago(30), oid: head, state: "FAILURE" }];
    const rework = issue(7, "ready", {
      prs: [
        pr({ branch: "factory/70-other", number: 69 }),
        unreviewed({
          branch: "factory/7-fix-it",
          number: 71,
          verdicts: failed,
        }),
      ],
    });
    expect(pickWork([rework])).toEqual({
      ok: true,
      out: { issue: 7, mode: "rework", pr: 71, reason: "review" },
    });
    const closed = issue(7, "ready", {
      prs: [pr({ branch: "factory/7-fix-it", state: "CLOSED" })],
    });
    expect(pickWork([closed])).toEqual({
      ok: true,
      out: { issue: 7, mode: "fresh", reason: "fresh" },
    });
  });

  test("skips cards with an open blocked-by issue", () => {
    const blocked = issue(1, "ready", { blockers: ["CLOSED", "OPEN"] });
    const done = issue(2, "ready", { blockers: ["CLOSED"] });
    expect(pickWork([blocked, done])).toEqual({
      ok: true,
      out: { issue: 2, mode: "fresh", reason: "fresh" },
    });
    expect(pickWork([blocked]).ok).toBe(false);
  });

  test("a claim since the last move to Ready holds the card for the worker cap", () => {
    const claim = "<!-- factory:claim OpenHubris/auto-work-run-1 -->";
    const claimed = issue(1, "ready", {
      markers: [marker(claim, 5)],
      statusAt: ago(10),
    });
    expect(pickWork([claimed, issue(2, "ready")])).toEqual({
      ok: true,
      out: { issue: 2, mode: "fresh", reason: "fresh" },
    });
    const stale = { ...claimed, markers: [marker(claim, 4 * 60)] };
    expect(pickWork([{ ...stale, statusAt: ago(5 * 60) }]).ok).toBe(true);
    const beforeRework = { ...claimed, statusAt: ago(2) };
    expect(pickWork([beforeRework]).ok).toBe(true);
  });

  test("a pick this machine made in the last 3 minutes holds the card and counts toward the cap", () => {
    const picks = { 1: now - 60_000, 2: now - 4 * 60_000 };
    const held = heldPicks(picks, now);
    expect(held).toEqual([1]);
    const ready = [issue(1, "ready"), issue(2, "ready")];
    expect(decideWorker(ready, 2, now, held)).toEqual({
      ok: true,
      out: { issue: 2, mode: "fresh", reason: "fresh" },
    });
    expect(
      decideWorker([...ready, issue(3, "in-progress")], 2, now, held),
    ).toEqual({ ok: false, why: "wip 2/2" });
  });

  test("respects the wip cap on In progress cards", () => {
    const one = [issue(1, "in-progress"), issue(2, "ready")];
    const two = [issue(3, "in-progress"), ...one];
    expect(decideWorker(one, 2, now).ok).toBe(true);
    expect(decideWorker(two, 2, now)).toEqual({ ok: false, why: "wip 2/2" });
  });
});

describe("reviewer", () => {
  test("picks the oldest In review card whose head lacks factory/review", () => {
    const issues = [
      issue(8, "in-review", { prs: [unreviewed({ number: 80 })] }),
      issue(5, "in-review", { prs: [unreviewed({ number: 50 })] }),
      issue(3, "in-progress", { prs: [unreviewed({ number: 30 })] }),
    ];
    expect(pickReview(issues)).toEqual({
      ok: true,
      out: { issue: 5, pr: 50 },
    });
  });

  test("a verdict on the head, drafts, closed and missing PRs are skipped", () => {
    const failed = unreviewed({
      statuses: [{ name: "factory/review", state: "FAILURE" }],
    });
    const issues = [
      issue(1, "in-review", { prs: [pr()] }),
      issue(2, "in-review", { prs: [failed] }),
      issue(3, "in-review", { prs: [unreviewed({ draft: true })] }),
      issue(4, "in-review", { prs: [unreviewed({ state: "MERGED" })] }),
      issue(5, "in-review"),
    ];
    expect(pickReview(issues).ok).toBe(false);
  });

  test("a verdict on an older head does not count for the new head", () => {
    const moved = pr({ checked: "abc", head });
    expect(pickReview([issue(1, "in-review", { prs: [moved] })])).toEqual({
      ok: true,
      out: { issue: 1, pr: 100 },
    });
  });

  test("a live claim for the current head locks the card and counts toward the cap", () => {
    const claim = (sha: string, minutes: number) =>
      marker(
        `<!-- factory:claim OpenHubris/auto-review-run-1 ${sha} -->`,
        minutes,
      );
    const claimed = (n: number) =>
      issue(n, "in-review", {
        markers: [claim(head, 5)],
        prs: [unreviewed({ number: n * 10 })],
      });
    const waiting = issue(9, "in-review", {
      prs: [unreviewed({ number: 90 })],
    });
    expect(decideReviewer([claimed(1), waiting], 2, now)).toEqual({
      ok: true,
      out: { issue: 9, pr: 90 },
    });
    expect(decideReviewer([claimed(1), claimed(2), waiting], 2, now)).toEqual({
      ok: false,
      why: "reviewing 2/2",
    });
    const oldHead = { ...claimed(1), markers: [claim("e".repeat(40), 5)] };
    const expired = { ...claimed(1), markers: [claim(head, 90)] };
    for (const card of [oldHead, expired])
      expect(pickReview([card])).toEqual({
        ok: true,
        out: { issue: 1, pr: 10 },
      });
  });

  test("a card with a live landing marker waits for the merger", () => {
    const landing = (minutes: number) =>
      issue(1, "in-review", {
        markers: [
          marker(
            "<!-- factory:landing OpenHubris/auto-merge-run-1 -->",
            minutes,
          ),
        ],
        prs: [unreviewed()],
      });
    expect(pickReview([landing(5)])).toEqual({
      ok: false,
      why: "no PR awaiting review",
    });
    expect(pickReview([landing(90)])).toEqual({
      ok: true,
      out: { issue: 1, pr: 100 },
    });
  });
});

describe("merger", () => {
  test("picks the oldest In review card with green signoff, ci and review", () => {
    const issues = [
      issue(6, "in-review", { prs: [pr({ number: 60 })] }),
      issue(4, "in-review", { prs: [pr({ decision: null, number: 40 })] }),
      issue(2, "ready", { prs: [pr({ number: 20 })] }),
    ];
    expect(decideMerger(issues, now, false)).toEqual({
      ok: true,
      out: { approval: "not-required", issue: 4, pr: 40 },
    });
    expect(decideMerger(issues, now, true)).toEqual({
      ok: true,
      out: { approval: "required", issue: 6, pr: 60 },
    });
  });

  test("every one of the three statuses must be green on the current head", () => {
    const all = pr().statuses;
    for (const name of ["signoff/ci", "factory/ci", "factory/review"]) {
      const statuses = all.map((s) =>
        s.name === name ? { ...s, state: "PENDING" } : s,
      );
      const missing = all.filter((s) => s.name !== name);
      for (const candidate of [pr({ statuses }), pr({ statuses: missing })])
        expect(
          decideMerger(
            [issue(4, "in-review", { prs: [candidate] })],
            now,
            false,
          ).ok,
        ).toBe(false);
    }
    const moved = pr({ checked: "abc", head: "def" });
    expect(
      decideMerger([issue(4, "in-review", { prs: [moved] })], now, false).ok,
    ).toBe(false);
  });

  test("skips open blocked-by and stacked children, and lands past them", () => {
    const issues = [
      issue(2, "in-review", { prs: [pr({ base: "factory/1-parent" })] }),
      issue(3, "in-review", { blockers: ["OPEN"], prs: [pr({ number: 30 })] }),
      issue(4, "in-review", {
        blockers: ["CLOSED"],
        prs: [pr({ number: 40 })],
      }),
    ];
    expect(decideMerger(issues, now, false)).toEqual({
      ok: true,
      out: { approval: "not-required", issue: 4, pr: 40 },
    });
  });

  test("a live landing marker blocks every merge; an expired one does not", () => {
    const landing = (minutes: number) =>
      issue(6, "in-review", {
        markers: [
          marker(
            "<!-- factory:landing OpenHubris/auto-merge-run-1 -->",
            minutes,
            55,
          ),
        ],
      });
    const ready = issue(4, "in-review", { prs: [pr()] });
    expect(decideMerger([ready, landing(10)], now, false)).toEqual({
      ok: false,
      why: "#6 is landing",
    });
    expect(decideMerger([ready, landing(90)], now, false).ok).toBe(true);
  });
});

describe("landings", () => {
  test("lists live markers on In review cards, oldest first", () => {
    const body = (run: string) => `<!-- factory:landing ${run} -->`;
    const issues = [
      issue(1, "in-review", { markers: [marker(body("b"), 5, 11)] }),
      issue(2, "in-review", { markers: [marker(body("a"), 9, 12)] }),
      issue(3, "done", { markers: [marker(body("c"), 1, 13)] }),
      issue(4, "in-review", {
        markers: [marker("<!-- factory:claim x -->", 1, 14)],
      }),
    ];
    expect(liveLandings(issues, now)).toEqual([
      { at: ago(9), id: 12, issue: 2, run: "a" },
      { at: ago(5), id: 11, issue: 1, run: "b" },
    ]);
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
