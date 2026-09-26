import { expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { git, gitEnv } from "test/git";

const nested = "TUICRAFT_GIT_ENV_SUITE";

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

test("the suite run with GIT_DIR exported leaves both repositories' config unchanged", async () => {
  if (Bun.env[nested] === "1") return;
  const sandbox = `${process.cwd()}/tmp/git-env-${Date.now()}`;
  const real = `${(await git(process.cwd(), "rev-parse", "--path-format=absolute", "--git-common-dir")).trim()}/config`;
  try {
    await mkdir(sandbox, { recursive: true });
    await git(sandbox, "init", "-q");
    const before = {
      real: await Bun.file(real).text(),
      sandbox: await Bun.file(`${sandbox}/.git/config`).text(),
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
      real: await Bun.file(real).text(),
      sandbox: await Bun.file(`${sandbox}/.git/config`).text(),
    }).toEqual(before);
    expect({ code, tail: stderr.slice(-2000) }).toMatchObject({ code: 0 });
  } finally {
    await rm(sandbox, { force: true, recursive: true });
  }
}, 120_000);
