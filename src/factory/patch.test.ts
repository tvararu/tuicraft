import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { samePatch } from "factory/patch";
import { git } from "test/git";

const identity = ["-c", "user.name=t", "-c", "user.email=t@example.com"];

async function commitFile(dir: string, text: string, msg: string) {
  await Bun.write(`${dir}/f.txt`, text);
  await git(dir, "add", "f.txt");
  await git(dir, ...identity, "commit", "-q", "-m", msg);
  return (await git(dir, "rev-parse", "HEAD")).trim();
}

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

describe("samePatch", () => {
  test("a rebase that only moves context keeps the patch; a new change does not", async () => {
    const dir = await mkdtemp(`${tmpdir()}/same-patch-`);
    const inRepo = (args: string[]) => git(dir, ...args);
    try {
      await git(dir, "init", "-q", "-b", "main");
      const base = await commitFile(dir, `${lines(10)}\n`, "chore: Base");
      await git(dir, "switch", "-q", "-c", "pr");
      const old = await commitFile(
        dir,
        `${lines(10).replace("line 8", "line eight")}\n`,
        "feat: Pr",
      );
      await git(dir, "switch", "-q", "main");
      const main = await commitFile(
        dir,
        `top\n${lines(10).replace("line 6", "line six")}\n`,
        "chore: Main",
      );
      const rebased = await commitFile(
        dir,
        `top\n${lines(10).replace("line 6", "line six").replace("line 8", "line eight")}\n`,
        "feat: Pr",
      );
      const match = await samePatch(
        `${base}..${old}`,
        `${main}..${rebased}`,
        inRepo,
      );
      expect(match.same).toBe(true);
      const changed = await commitFile(
        dir,
        `top\n${lines(10).replace("line 6", "line six").replace("line 8", "line 8!")}\n`,
        "feat: Pr",
      );
      expect(
        (await samePatch(`${base}..${old}`, `${main}..${changed}`, inRepo))
          .same,
      ).toBe(false);
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });
});
