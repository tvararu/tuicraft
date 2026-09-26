import { describe, expect, test } from "bun:test";
import { type DocKind, staleFindings } from "#tools/stale-docs";

function matches(text: string, kind: DocKind = "instructions"): string[] {
  return staleFindings({ kind, path: "doc.md", text }).map((f) => f.match);
}

describe("staleFindings", () => {
  test("reports dated history wrapped across lines at its first line", () => {
    const text =
      "Intro.\nThe maintainer retired the branch on\n2026-09-26: see.";
    expect(staleFindings({ kind: "instructions", path: "A.md", text })).toEqual(
      [
        {
          line: 2,
          match: "on 2026-09-26",
          path: "A.md",
          reason: "says when something changed: state what holds now",
        },
      ],
    );
  });

  test("flags each history form in instruction docs", () => {
    const text = [
      "squash merges (since 2026-09-26)",
      "The ruling of 2026-09-21 holds; it was split in the 2026-09-24 review.",
      "The follow command was deleted in 05ee035 at the maintainer's request.",
    ].join("\n");
    expect(matches(text)).toEqual([
      "since 2026-09-26",
      "ruling of 2026-09-21",
      "2026-09-24 review",
      "was deleted",
      "at the maintainer's request",
    ]);
  });

  test("keeps dates the reader needs", () => {
    const text =
      "Audited 2026-09-26 against main. The 2026-09-23 run window had skips.";
    expect(matches(text)).toEqual([]);
  });

  test("evidence docs keep record dates but not tmp paths", () => {
    const text =
      "One session on 2026-09-26, accounts deleted after the run.\nJournal: `tmp/m5-final/journal.md`.";
    expect(matches(text, "evidence")).toEqual(["tmp/m5-final/journal.md"]);
  });

  test("allows bare tmp/, the system /tmp/ and paths a command writes", () => {
    const text = [
      "Use `./tmp/` for scratch, not `/tmp/x`; only in `tmp/` satisfies nothing.",
      "Built into `tmp/namigator/libnamigator.so`.",
      "Patches go to `tmp/worktree-archive-<date>/`.",
      "`bun $F squash-message M > tmp/squash.json`, tmp/qa-changes.json",
    ].join("\n");
    expect(matches(text)).toEqual([]);
  });

  test("flags other tmp paths, deleted notes files and old names", () => {
    const text = [
      "from `tuicraft:tmp/gameplay-data/raw/`, see tmp/overnight.",
      "Read DECISIONS.md and the ovn-7 or `gameplay-*` worktrees.",
      "The factory-worker automation.",
    ].join("\n");
    expect(matches(text)).toEqual([
      "tmp/gameplay-data/raw/",
      "tmp/overnight",
      "DECISIONS.md",
      "ovn-",
      "gameplay-*",
      "factory-worker",
    ]);
  });
  test("flags source paths that do not exist in instruction docs", () => {
    const exists = (path: string) =>
      [
        "packages/core/src/wow/client.ts",
        "packages/factory/src/prompts",
      ].includes(path);
    const text = [
      "See `src/wow/client.ts` and `packages/core/src/wow/client.ts`.",
      "Prompts: `packages/factory/src/prompts/*.md`, gone: `packages/cli/src/nope.ts`.",
      "AzerothCore `src/server/game/Handlers/SpellHandler.cpp` and `../wowser/src/lib/auth/`.",
      "Runner: `F=~/r/runner/src/factory/main.ts`, `./src/main.ts` and `$root/src/main.ts`.",
    ].join("\n");
    expect(
      staleFindings({ kind: "instructions", path: "A.md", text }, exists).map(
        (f) => f.match,
      ),
    ).toEqual([
      "src/wow/client.ts",
      "packages/cli/src/nope.ts",
      "src/factory/main.ts",
      "src/main.ts",
      "src/main.ts",
    ]);
    expect(
      staleFindings({ kind: "evidence", path: "E.md", text }, exists),
    ).toEqual([]);
  });
});
