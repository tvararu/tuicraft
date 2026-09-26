import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { strayMessage, strayWorktree } from "factory/repo-guard";
import { git } from "test/git";

let counter = 0;
let repo = "";

beforeEach(async () => {
  counter += 1;
  repo = `${process.cwd()}/tmp/repo-guard-${Date.now()}-${counter}`;
  await mkdir(repo, { recursive: true });
  await git(repo, "init", "-q");
});

afterEach(async () => {
  await rm(repo, { force: true, recursive: true });
});

describe("strayWorktree", () => {
  test("is null when core.worktree is unset", async () => {
    expect(await strayWorktree(repo)).toBeNull();
  });

  test("returns the value when core.worktree is set", async () => {
    await git(repo, "config", "core.worktree", "/wt/run-26");
    expect(await strayWorktree(repo)).toBe("/wt/run-26");
  });

  test("the message names the value and the unset command", () => {
    const message = strayMessage("/wt/run-26", "/r");
    expect(message).toContain(
      "git config --file /r/.git/config --unset core.worktree",
    );
  });
});
