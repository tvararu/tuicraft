import { describe, expect, test } from "bun:test";
import { bounce, bouncedHeads, movedHeads } from "factory/bounce";
import { ago, issue, marker, now, pr } from "test/factory-fixtures";

const a = "a".repeat(40);
const b = "b".repeat(40);
const c = "c".repeat(40);
const pass = (oid: string, minutes: number) => ({
  at: ago(minutes),
  oid,
  state: "SUCCESS",
});
const fail = (oid: string, minutes: number) => ({
  ...pass(oid, minutes),
  state: "FAILURE",
});
const movedPr = (extra = {}) =>
  pr({
    checked: b,
    head: b,
    number: 7,
    statuses: [],
    verdicts: [pass(a, 30)],
    ...extra,
  });

describe("movedHeads", () => {
  test("an In review head that changed after a passing review has moved", () => {
    expect(
      movedHeads([issue(1, "in-review", { prs: [movedPr()] })], now),
    ).toEqual([{ head: b, issue: 1, pr: 7 }]);
  });

  test("a head that changed after a failed review is a rework, not a bounce", () => {
    const rework = movedPr({ verdicts: [pass(c, 90), fail(a, 30)] });
    const again = movedPr({ verdicts: [fail(c, 90), pass(a, 30)] });
    expect(
      movedHeads(
        [
          issue(1, "in-review", { prs: [rework] }),
          issue(2, "in-review", { prs: [again] }),
        ],
        now,
      ),
    ).toEqual([{ head: b, issue: 2, pr: 7 }]);
  });

  test("reviewed heads, heads with their own verdict, drafts and other columns stay put", () => {
    const reviewed = pr({ verdicts: [pass(a, 30), pass("abc", 5)] });
    const judged = movedPr({ verdicts: [pass(a, 30), fail(b, 5)] });
    const fresh = movedPr({ verdicts: [] });
    expect(
      movedHeads(
        [
          issue(1, "in-review", { prs: [reviewed] }),
          issue(2, "in-review", { prs: [judged] }),
          issue(3, "in-review", { prs: [fresh] }),
          issue(4, "in-review", { prs: [movedPr({ draft: true })] }),
          issue(5, "blocked", { prs: [movedPr()] }),
          issue(6, "ready", { prs: [movedPr()] }),
        ],
        now,
      ),
    ).toEqual([]);
  });

  test("nothing bounces while a landing is in flight", () => {
    const landing = marker(
      "<!-- factory:landing OpenHubris/auto-merge-run-1 -->",
      5,
    );
    expect(
      movedHeads(
        [
          issue(1, "in-review", { prs: [movedPr()] }),
          issue(2, "in-review", { markers: [landing], prs: [pr()] }),
        ],
        now,
      ),
    ).toEqual([]);
  });
});

describe("bounce", () => {
  const moved = { head: c, issue: 1, pr: 7 };

  test("the first two bounces keep the card In review with a marked comment", () => {
    for (const earlier of [[], [a]]) {
      const action = bounce(moved, earlier);
      expect(action.status).toBeNull();
      expect(action.comment?.split("\n")[0]).toBe(
        `<!-- factory:bounce ${c} -->`,
      );
      expect(bouncedHeads([action.comment ?? ""])).toEqual([c]);
    }
  });

  test("a third moved head goes to Blocked and says what to do", () => {
    const action = bounce(moved, [a, b]);
    expect(action.status).toBe("blocked");
    expect(action.comment).toContain("move the card to In review");
    expect(action.comment).not.toContain("@");
  });

  test("a head already bounced adds no second comment or count", () => {
    expect(bounce(moved, [a, c])).toEqual({ comment: null, status: null });
    expect(bounce(moved, [a, b, c]).comment).toBeNull();
  });

  test("bouncedHeads ignores other comments", () => {
    expect(
      bouncedHeads(["", "<!-- factory:claim run -->", "text", `x ${a}`]),
    ).toEqual([]);
  });
});
