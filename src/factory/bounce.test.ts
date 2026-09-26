import { describe, expect, test } from "bun:test";
import { bounce, bouncedHeads, movedHeads } from "factory/bounce";
import { issue, pr } from "test/factory-fixtures";

const a = "a".repeat(40);
const b = "b".repeat(40);
const c = "c".repeat(40);

describe("movedHeads", () => {
  test("a merging PR whose head lacks factory statuses has moved", () => {
    const moved = pr({ checked: a, head: a, number: 7, statuses: [] });
    const stale = pr({ checked: a, head: b, number: 8 });
    expect(
      movedHeads([
        issue(1, ["agent:merging"], { prs: [moved] }),
        issue(2, ["agent:merging"], { prs: [stale] }),
      ]),
    ).toEqual([
      { head: a, issue: 1, pr: 7 },
      { head: b, issue: 2, pr: 8 },
    ]);
  });

  test("reviewed heads, needs:pm, drafts and other labels stay put", () => {
    const moved = pr({ statuses: [] });
    expect(
      movedHeads([
        issue(1, ["agent:merging"], { prs: [pr()] }),
        issue(2, ["agent:merging", "needs:pm"], { prs: [moved] }),
        issue(3, ["agent:merging"], { prs: [{ ...moved, draft: true }] }),
        issue(4, ["agent:review"], { prs: [moved] }),
      ]),
    ).toEqual([]);
  });

  test("nothing bounces while a landing is in flight", () => {
    expect(
      movedHeads([
        issue(1, ["agent:merging"], { prs: [pr({ statuses: [] })] }),
        issue(2, ["agent:landing", "agent:merging"], { prs: [pr()] }),
      ]),
    ).toEqual([]);
  });
});

describe("bounce", () => {
  const moved = { head: c, issue: 1, pr: 7 };

  test("the first two bounces go back to review with a marked comment", () => {
    for (const earlier of [[], [a]]) {
      const action = bounce(moved, earlier);
      expect(action.add).toBe("agent:review");
      expect(action.comment?.split("\n")[0]).toBe(
        `<!-- factory:bounce ${c} -->`,
      );
      expect(bouncedHeads([action.comment ?? ""])).toEqual([c]);
    }
  });

  test("a third moved head goes to needs:pm", () => {
    expect(bounce(moved, [a, b]).add).toBe("needs:pm");
  });

  test("a head already bounced is relabelled without a second comment or count", () => {
    expect(bounce(moved, [a, c])).toEqual({
      add: "agent:review",
      comment: null,
    });
  });

  test("bouncedHeads ignores other comments", () => {
    expect(
      bouncedHeads(["", "<!-- factory:claim run -->", "text", `x ${a}`]),
    ).toEqual([]);
  });
});
