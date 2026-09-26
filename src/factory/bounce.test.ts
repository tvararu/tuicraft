import { describe, expect, test } from "bun:test";
import { bounce, type HeadMark, headMarks, movedHeads } from "factory/bounce";
import { ago, issue, marker, now, pr } from "test/factory-fixtures";

const a = "a".repeat(40);
const b = "b".repeat(40);
const c = "c".repeat(40);
const d = "d".repeat(40);
const e = "e".repeat(40);
const mark = (
  head: string,
  minutes: number,
  kind: HeadMark["kind"] = "bounce",
) => ({ at: ago(minutes), head, kind });
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
    ).toEqual([{ head: b, issue: 1, pr: 7, since: ago(600) }]);
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
    ).toEqual([{ head: b, issue: 2, pr: 7, since: ago(600) }]);
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
  const moved = { head: c, issue: 1, pr: 7, since: ago(120) };

  test("the first two bounces keep the card In review with a marked comment", () => {
    for (const marks of [[], [mark(a, 60)]]) {
      const action = bounce(moved, marks);
      expect(action?.status).toBeNull();
      expect(action?.comment.split("\n")[0]).toBe(
        `<!-- factory:bounce ${c} -->`,
      );
      expect(headMarks([{ at: ago(0), body: action?.comment ?? "" }])).toEqual([
        mark(c, 0),
      ]);
    }
  });

  test("a third moved head goes to Blocked and says what to do", () => {
    const action = bounce(moved, [mark(a, 60), mark(b, 30)]);
    expect(action?.status).toBe("blocked");
    expect(action?.comment).toContain("move the card to In review");
    expect(action?.comment).not.toContain("@");
  });

  test("a head already bounced adds no second comment or move", () => {
    expect(bounce(moved, [mark(a, 60), mark(c, 30)])).toBeNull();
    expect(bounce(moved, [mark(a, 60), mark(b, 45), mark(c, 30)])).toBeNull();
  });

  test("third bounce, Blocked, maintainer moves it back to In review: it stays", () => {
    const card = (head: string, statusAt: string) =>
      issue(1, "in-review", {
        prs: [movedPr({ checked: head, head, verdicts: [pass(a, 240)] })],
        statusAt,
      });
    const earlier = [mark(b, 90), mark(c, 60)];
    const [third] = movedHeads([card(d, ago(180))], now);
    expect(third && bounce(third, earlier)?.status).toBe("blocked");
    const marks = [...earlier, mark(d, 30)];
    const [back] = movedHeads([card(d, ago(10))], now);
    expect(back && bounce(back, marks)).toBeNull();
    const [settled] = movedHeads([card(e, ago(10))], now);
    const again = settled && bounce(settled, marks);
    expect(again?.status).toBeNull();
    expect(again?.comment).toContain("Bounce 1/2");
  });

  test("the merger's own rebase is not a bounce and does not count", () => {
    const rebased = mark(c, 5, "rebase");
    expect(bounce(moved, [mark(a, 60), rebased])).toBeNull();
    const next = bounce({ ...moved, head: d }, [mark(a, 60), rebased]);
    expect(next?.status).toBeNull();
    expect(next?.comment).toContain("Bounce 2/2");
  });

  test("headMarks reads bounce and rebase markers and ignores other comments", () => {
    const at = ago(1);
    expect(
      headMarks(
        [
          "",
          "<!-- factory:claim run -->",
          `x ${a}`,
          `<!-- factory:rebase ${b} -->\nRebased`,
          `<!-- factory:bounce ${c} -->`,
        ].map((body) => ({ at, body })),
      ),
    ).toEqual([mark(b, 1, "rebase"), mark(c, 1)]);
  });
});
