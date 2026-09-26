import { describe, expect, test } from "bun:test";
import { type SupersedeFacts, superseded } from "factory/reaper-supersede";

const facts: SupersedeFacts = {
  behind: false,
  branch: "factory/342-superseded-run-commits",
  prs: [],
  remoteTip: null,
};

describe("superseded", () => {
  test("a merged PR supersedes the run's commits", () => {
    const prs = [{ number: 350, state: "MERGED" as const }];
    expect(superseded({ ...facts, prs })).toBe("PR #350 merged");
  });

  test("a closed PR supersedes the run's commits", () => {
    const prs = [{ number: 351, state: "CLOSED" as const }];
    expect(superseded({ ...facts, prs, remoteTip: "abcdef123" })).toBe(
      "PR #351 closed",
    );
  });

  test("a branch rebased past the run's HEAD with an open PR supersedes it", () => {
    const prs = [
      { number: 300, state: "CLOSED" as const },
      { number: 352, state: "OPEN" as const },
    ];
    expect(superseded({ ...facts, prs, remoteTip: "abcdef123" })).toBe(
      "factory/342-superseded-run-commits moved on to abcdef1 with PR #352 open",
    );
  });

  test("an open PR whose branch is behind the run's HEAD holds", () => {
    const prs = [{ number: 352, state: "OPEN" as const }];
    expect(
      superseded({ ...facts, behind: true, prs, remoteTip: "abcdef123" }),
    ).toBeNull();
  });

  test("an open PR whose branch is gone from GitHub holds", () => {
    const prs = [{ number: 352, state: "OPEN" as const }];
    expect(superseded({ ...facts, prs })).toBeNull();
  });

  test("commits with no PR hold even when the branch moved on", () => {
    expect(superseded(facts)).toBeNull();
    expect(superseded({ ...facts, remoteTip: "abcdef123" })).toBeNull();
  });
});
