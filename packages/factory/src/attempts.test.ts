import { describe, expect, test } from "bun:test";
import { runReason } from "#factory/attempts";
import type { Verdict } from "#factory/github";
import { ago, pr } from "#test-support/factory-fixtures";

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
const at = (head: string, verdicts: Verdict[]) =>
  pr({ checked: head, head, verdicts });

describe("runReason", () => {
  test("no open factory PR means the run opens the first one", () => {
    expect(runReason(undefined)).toBe("fresh");
  });

  test("a head that failed review is a review rework", () => {
    expect(runReason(at(a, [fail(a, 30)]))).toBe("review");
    expect(runReason(at(c, [pass(a, 90), fail(b, 60), fail(c, 30)]))).toBe(
      "review",
    );
  });

  test("a failed review answered by a newer unreviewed head is a recovery", () => {
    expect(runReason(at(b, [fail(a, 30)]))).toBe("recovery");
    expect(runReason(at(c, [pass(a, 90), fail(b, 60)]))).toBe("recovery");
  });

  test("a PR the reviewer never judged is a recovery", () => {
    expect(runReason(at(a, []))).toBe("recovery");
  });

  test("a PR sent back after its latest review passed is a merger rebase", () => {
    expect(runReason(at(a, [pass(a, 30)]))).toBe("rebase");
    expect(runReason(at(b, [pass(a, 30)]))).toBe("rebase");
    expect(runReason(at(b, [fail(a, 90), pass(b, 30)]))).toBe("rebase");
  });

  test("the newest verdict decides, whatever order GitHub lists them in", () => {
    expect(runReason(at(b, [pass(b, 30), fail(a, 90)]))).toBe("rebase");
    expect(runReason(at(b, [pass(a, 90), fail(b, 30)]))).toBe("review");
  });
});
