import { describe, expect, test } from "bun:test";
import { type LandFacts, landed, prHeads } from "#factory/reaper-land";

const facts: LandFacts = {
  ahead: 2,
  branchPatch: "p1",
  cherry: "+ c1\n+ c2\n",
  mainPatches: ["p9"],
  mergedHeads: [],
  tip: "abc",
};

describe("landed", () => {
  test("unlanded when no proof holds", () => {
    expect(landed(facts)).toBe(false);
  });

  test("no commits beyond origin/main", () => {
    expect(landed({ ...facts, ahead: 0, cherry: "" })).toBe(true);
  });

  test("a squash-merged PR counts when the local tip was one of its heads", () => {
    expect(landed({ ...facts, mergedHeads: ["old"] })).toBe(false);
    expect(landed({ ...facts, mergedHeads: ["old", "abc"] })).toBe(true);
  });

  test("cherry must be all minus lines", () => {
    expect(landed({ ...facts, cherry: "- c1\n- c2\n" })).toBe(true);
    expect(landed({ ...facts, cherry: "- c1\n+ c2\n" })).toBe(false);
  });

  test("a squash commit can match the whole-branch patch id", () => {
    expect(landed({ ...facts, mainPatches: ["p9", "p1"] })).toBe(true);
    expect(landed({ ...facts, branchPatch: "", mainPatches: [""] })).toBe(
      false,
    );
  });
});

describe("prHeads", () => {
  test("collects the merged head, its commits and every force-pushed head", () => {
    const heads = prHeads([
      {
        commits: {
          nodes: [{ commit: { oid: "c1" } }, { commit: { oid: "m" } }],
        },
        headRefOid: "m",
        timelineItems: {
          nodes: [
            { afterCommit: { oid: "r1" }, beforeCommit: { oid: "w1" } },
            { afterCommit: { oid: "m" }, beforeCommit: null },
            {},
          ],
        },
      },
    ]);
    expect(heads.toSorted()).toEqual(["c1", "m", "r1", "w1"]);
  });
});
