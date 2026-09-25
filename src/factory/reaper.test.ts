import { describe, expect, test } from "bun:test";
import {
  autoAction,
  idleFor,
  isClean,
  type LandFacts,
  landed,
  otherAction,
  overCap,
  ownerOf,
  roleOf,
  runAge,
  runDone,
  strayIgnored,
  type Worktree,
} from "factory/reaper";

const hour = 3_600_000;
const now = Date.parse("2026-09-25T12:00:00Z");

function wt(over: Partial<Worktree>): Worktree {
  const base = {
    branch: "refs/heads/w",
    displayName: "w",
    id: "r::/w",
    path: "/w",
    repoId: "r",
  };
  const meta = {
    cliProvenance: null,
    isMainWorktree: false,
    lastActivityAt: now,
    parentWorktreeId: null,
  };
  return { ...base, ...meta, ...over };
}

const cli = { createdAt: now - 5 * hour, kind: "created-by-cli" };
const main = wt({
  displayName: "tuicraft",
  id: "r::/main",
  isMainWorktree: true,
});
const coord = wt({
  cliProvenance: cli,
  displayName: "dev-factory",
  id: "r::/coord",
  parentWorktreeId: main.id,
});

describe("ownerOf", () => {
  test("auto run worktrees belong to the reaper with the automation's role", () => {
    const run = wt({
      displayName: "auto-factory-reviewer-run-4-20260925T1200",
    });
    expect(ownerOf(run, [])).toEqual({
      automation: "factory-reviewer",
      kind: "reaper",
      role: "reviewer",
    });
  });

  test("cli-created worktrees belong to their parent", () => {
    const child = wt({
      cliProvenance: cli,
      displayName: "probe",
      parentWorktreeId: coord.id,
    });
    expect(ownerOf(child, [main, coord])).toEqual({
      kind: "owner",
      name: "dev-factory",
    });
  });

  test("worktrees without cli provenance belong to theo", () => {
    expect(ownerOf(wt({ parentWorktreeId: coord.id }), [coord])).toEqual({
      kind: "owner",
      name: "theo",
    });
  });

  test("a name that only starts with auto- is not a run", () => {
    expect(ownerOf(wt({ displayName: "auto-save" }), []).kind).toBe("owner");
  });
});

describe("roleOf", () => {
  test("reads the role from factory-<role>", () => {
    expect(roleOf("factory-qa")).toBe("qa");
    expect(roleOf("factory-merger")).toBe("merger");
  });

  test("unknown automations get the longest cap", () => {
    expect(roleOf("probe-factory-overlap")).toBe("worker");
  });
});

describe("idleFor", () => {
  test("uses the newest of worktree activity and its terminals' output", () => {
    const tree = wt({ lastActivityAt: now - 20 * hour });
    const terms = [
      { lastOutputAt: now - 2 * hour, worktreeId: tree.id },
      { lastOutputAt: now, worktreeId: "other" },
      { lastOutputAt: null, worktreeId: tree.id },
    ];
    expect(idleFor(tree, terms, now)).toBe(2);
  });

  test("with no terminals only worktree activity counts", () => {
    expect(idleFor(wt({ lastActivityAt: now - 13 * hour }), [], now)).toBe(13);
  });
});

describe("run state", () => {
  test("completed and failed runs are done, dispatched and unknown are not", () => {
    expect(runDone({ status: "completed", workspaceId: "x" })).toBe(true);
    expect(runDone({ status: "failed", workspaceId: "x" })).toBe(true);
    expect(runDone({ status: "dispatched", workspaceId: "x" })).toBe(false);
    expect(runDone(undefined)).toBe(false);
  });

  test("age prefers dispatchedAt, accepts ISO strings, falls back to creation", () => {
    const iso = new Date(now - 90 * 60_000).toISOString();
    expect(
      runAge(
        {
          dispatchedAt: iso,
          startedAt: 0,
          status: "dispatched",
          workspaceId: "x",
        },
        wt({}),
        now,
      ),
    ).toBe(1.5);
    expect(runAge(undefined, wt({ cliProvenance: cli }), now)).toBe(5);
  });

  test("cap is exceeded only past the role's hours", () => {
    expect(overCap(1, "reviewer")).toBe(false);
    expect(overCap(1.01, "reviewer")).toBe(true);
    expect(overCap(2.5, "worker")).toBe(false);
  });
});

describe("clean", () => {
  test("allowlisted ignored directories at any depth are fine", () => {
    expect(
      isClean(["!! node_modules/", "!! packages/a/dist/", "!! coverage/"]),
    ).toBe(true);
  });

  test("other ignored files are dirty and listed for the tarball", () => {
    const status = ["!! node_modules/", "!! tmp/", "!! .env", "!! src/dist"];
    expect(isClean(status)).toBe(false);
    expect(strayIgnored(status)).toEqual(["tmp/", ".env", "src/dist"]);
  });

  test("tracked or untracked changes are dirty", () => {
    expect(isClean(["?? notes.txt"])).toBe(false);
    expect(isClean([" M README.md"])).toBe(false);
    expect(isClean([])).toBe(true);
  });

  test("factory runs may leave ignored scratch but not real changes", () => {
    expect(isClean(["!! tmp/", "!! .env"], true)).toBe(true);
    expect(isClean(["!! tmp/", "?? notes.txt"], true)).toBe(false);
    expect(isClean([" M README.md"], true)).toBe(false);
  });
});

describe("landed", () => {
  const facts: LandFacts = {
    ahead: 2,
    branchPatch: "p1",
    cherry: "+ c1\n+ c2\n",
    mainPatches: ["p9"],
    mergedTips: [],
    tip: "abc",
  };

  test("unlanded when no proof holds", () => {
    expect(landed(facts)).toBe(false);
  });

  test("no commits beyond origin/main", () => {
    expect(landed({ ...facts, ahead: 0, cherry: "" })).toBe(true);
  });

  test("merged PR only counts when its head is the local tip", () => {
    expect(landed({ ...facts, mergedTips: ["old"] })).toBe(false);
    expect(landed({ ...facts, mergedTips: ["old", "abc"] })).toBe(true);
  });

  test("cherry must be all minus lines", () => {
    expect(landed({ ...facts, cherry: "- c1\n- c2\n" })).toBe(true);
    expect(landed({ ...facts, cherry: "- c1\n+ c2\n" })).toBe(false);
  });

  test("squash merge matches the whole-branch patch id", () => {
    expect(landed({ ...facts, mainPatches: ["p9", "p1"] })).toBe(true);
    expect(landed({ ...facts, branchPatch: "", mainPatches: [""] })).toBe(
      false,
    );
  });
});

describe("autoAction", () => {
  test("a running run within its cap is left alone", () => {
    expect(
      autoAction({ clean: false, done: false, over: false, pushed: false }),
    ).toEqual({ kind: "skip", why: "running" });
  });

  test("done, clean and pushed is removed", () => {
    expect(
      autoAction({ clean: true, done: true, over: false, pushed: true }),
    ).toEqual({ kind: "remove" });
  });

  test("dirty trees are archived, stopped and held", () => {
    const hold = { archive: true, close: true, kind: "hold" } as const;
    expect(
      autoAction({ clean: false, done: true, over: false, pushed: true }),
    ).toEqual({ ...hold, reason: "dirty" });
    expect(
      autoAction({ clean: false, done: false, over: true, pushed: true }),
    ).toEqual({ ...hold, reason: "over-cap-dirty" });
  });

  test("clean with unpushed commits is stopped and held without archive", () => {
    const action = autoAction({
      clean: true,
      done: true,
      over: true,
      pushed: false,
    });
    expect(action).toEqual({
      archive: false,
      close: true,
      kind: "hold",
      reason: "unlanded-commits",
    });
  });
});

describe("otherAction", () => {
  test("not idle is skipped even when removable", () => {
    expect(otherAction({ clean: true, idle: false, landed: true })).toEqual({
      kind: "skip",
      why: "not idle",
    });
  });

  test("removed only when idle, landed and clean", () => {
    expect(otherAction({ clean: true, idle: true, landed: true })).toEqual({
      kind: "remove",
    });
  });

  test("dirty wins over unlanded and is archived but terminals stay", () => {
    expect(otherAction({ clean: false, idle: true, landed: false })).toEqual({
      archive: true,
      close: false,
      kind: "hold",
      reason: "dirty",
    });
    expect(otherAction({ clean: true, idle: true, landed: false })).toEqual({
      archive: false,
      close: false,
      kind: "hold",
      reason: "unlanded-commits",
    });
  });
});
