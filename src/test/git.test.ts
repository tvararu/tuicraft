import { expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { git, gitEnv } from "test/git";

const nested = "TUICRAFT_GIT_ENV_SUITE";

async function settingsOutsideBranches(config: string): Promise<string[]> {
  const list = ["config", "--file", config, "--list", "-z"];
  const entries = await git(process.cwd(), ...list);
  return entries
    .split("\0")
    .filter((entry) => entry !== "" && !entry.startsWith("branch."))
    .map((entry) => entry.replace("\n", "="));
}

test("gitEnv drops every GIT_ variable and keeps the rest", () => {
  expect(
    gitEnv({
      GIT_DIR: "/r/.git",
      GIT_WORK_TREE: "/r",
      HOME: "/h",
      X: undefined,
    }),
  ).toEqual({ HOME: "/h" });
});

test("the suite run with GIT_DIR exported writes no config to either repository", async () => {
  if (Bun.env[nested] === "1") return;
  const sandbox = `${process.cwd()}/tmp/git-env-${Date.now()}`;
  const shared = `${(await git(process.cwd(), "rev-parse", "--path-format=absolute", "--git-common-dir")).trim()}/config`;
  try {
    await mkdir(sandbox, { recursive: true });
    await git(sandbox, "init", "-q");
    const before = {
      sandbox: await Bun.file(`${sandbox}/.git/config`).text(),
      shared: await settingsOutsideBranches(shared),
    };
    const suite = Bun.spawn(["bun", "test"], {
      env: {
        ...Bun.env,
        GIT_DIR: `${sandbox}/.git`,
        GIT_WORK_TREE: sandbox,
        [nested]: "1",
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stderr, code] = await Promise.all([
      new Response(suite.stderr).text(),
      suite.exited,
      new Response(suite.stdout).text(),
    ]);
    expect({
      sandbox: await Bun.file(`${sandbox}/.git/config`).text(),
      shared: await settingsOutsideBranches(shared),
    }).toEqual(before);
    expect({ code, tail: stderr.slice(-2000) }).toMatchObject({ code: 0 });
  } finally {
    await rm(sandbox, { force: true, recursive: true });
  }
}, 120_000);
