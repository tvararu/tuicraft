import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolvePaths } from "lib/paths";
import { git, gitEnv } from "test/git";

const launcher = `${import.meta.dir}/omp-factory`;
const fakeOmp = `#!/usr/bin/env bash
printf '%s\\n' "\${XDG_CONFIG_HOME:-}" "\${XDG_RUNTIME_DIR:-}" "\${XDG_STATE_HOME:-}" "$@"
`;

type Launch = {
  config: string;
  runtime: string;
  state: string;
  args: string[];
};

let home: string;
let main: string;
let worktree: string;
let other: string;

function runtimeFor(gitDir: string): string {
  const hash = new Bun.CryptoHasher("sha256").update(gitDir).digest("hex");
  return `${home}/run/tuicraft-factory-${hash.slice(0, 12)}`;
}

async function launch(
  cwd: string,
  prompt: string,
  xdg: Record<string, string> = {},
): Promise<Launch> {
  const env = gitEnv();
  delete env["XDG_CONFIG_HOME"];
  delete env["XDG_STATE_HOME"];
  const proc = Bun.spawn([launcher, prompt], {
    cwd,
    env: {
      ...env,
      HOME: home,
      PATH: `${home}/bin:${Bun.env["PATH"]}`,
      XDG_RUNTIME_DIR: `${home}/run`,
      ...xdg,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`omp-factory exited ${code}: ${err}`);
  const [config = "", runtime = "", state = "", ...args] = out
    .trimEnd()
    .split("\n");
  return { args, config, runtime, state };
}

async function mirrored(dir: string): Promise<Record<string, string>> {
  const links: Record<string, string> = {};
  for (const name of await readdir(dir))
    links[name] = await readlink(`${dir}/${name}`);
  return links;
}

beforeAll(async () => {
  home = await realpath(await mkdtemp(`${tmpdir()}/omp-factory-`));
  await mkdir(`${home}/bin`);
  await writeFile(`${home}/bin/omp`, fakeOmp, { mode: 0o755 });
  for (const dir of [
    ".config/gh",
    ".config/tuicraft",
    ".local/state/mise",
    ".local/state/tuicraft",
    "run/tuicraft",
  ])
    await mkdir(`${home}/${dir}`, { recursive: true });
  await writeFile(`${home}/run/bus`, "");
  main = `${home}/code/tuicraft`;
  worktree = `${home}/wt`;
  other = `${home}/other`;
  await mkdir(main, { recursive: true });
  await mkdir(other);
  await git(main, "init", "-q", "-b", "main");
  await git(
    main,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  await git(main, "worktree", "add", "-q", worktree);
});

afterAll(() => rm(home, { force: true, recursive: true }));

describe("omp-factory", () => {
  test("keeps the default XDG dirs outside tuicraft worktrees", async () => {
    for (const cwd of [main, other]) {
      const run = await launch(cwd, "hello");
      expect(run).toEqual({
        args: ["hello"],
        config: "",
        runtime: `${home}/run`,
        state: "",
      });
    }
  });

  test("gives a linked worktree per-run dirs mirroring all but tuicraft", async () => {
    const run = await launch(worktree, "hello");
    const gitDir = `${main}/.git/worktrees/wt`;
    const base = `${gitDir}/factory-xdg`;
    expect(run).toEqual({
      args: ["hello"],
      config: `${base}/config`,
      runtime: runtimeFor(gitDir),
      state: `${base}/state`,
    });
    expect(await mirrored(run.config)).toEqual({ gh: `${home}/.config/gh` });
    expect(await mirrored(run.runtime)).toEqual({
      ".factory-gitdir": gitDir,
      bus: `${home}/run/bus`,
    });
    expect(await mirrored(run.state)).toEqual({
      mise: `${home}/.local/state/mise`,
    });
    const paths = resolvePaths({
      XDG_CONFIG_HOME: run.config,
      XDG_RUNTIME_DIR: run.runtime,
      XDG_STATE_HOME: run.state,
    });
    expect(paths.configPath).toBe(`${base}/config/tuicraft/config.toml`);
    expect(paths.socketPath).toBe(`${run.runtime}/tuicraft/sock`);
    expect(await git(worktree, "status", "--porcelain", "--ignored")).toBe("");
  });

  test("isolates a factory role even outside a tuicraft worktree", async () => {
    const run = await launch(other, "[factory:qa] go");
    const base = `${other}/tmp/factory-xdg`;
    expect(run.config).toBe(`${base}/config`);
    expect(run.runtime).toBe(runtimeFor(`${other}/tmp`));
    expect(run.state).toBe(`${base}/state`);
    expect(run.args).toContain("[factory:qa] go");
    expect(await mirrored(run.config)).toEqual({ gh: `${home}/.config/gh` });
    expect(await mirrored(run.runtime)).toEqual({
      ".factory-gitdir": `${other}/tmp`,
      bus: `${home}/run/bus`,
    });
  });

  test("keeps the systemd bus socket short for long worktree names", async () => {
    const name = "w".repeat(60);
    await git(main, "worktree", "add", "-q", `${home}/${name}`);
    const run = await launch(`${home}/${name}`, "[factory:worker] go");
    expect(run.runtime).toBe(runtimeFor(`${main}/.git/worktrees/${name}`));
    const suffix = run.runtime.slice(`${home}/run`.length);
    const socket = `/run/user/4294967294${suffix}/systemd/private`;
    expect(Buffer.byteLength(socket)).toBeLessThanOrEqual(107);
  });

  test("reuses the run's dirs when launched from an isolated shell", async () => {
    const outer = await launch(worktree, "hello");
    const inner = await launch(worktree, "[factory:worker] go", {
      XDG_CONFIG_HOME: outer.config,
      XDG_RUNTIME_DIR: outer.runtime,
      XDG_STATE_HOME: outer.state,
    });
    expect({ ...inner, args: [] }).toEqual({ ...outer, args: [] });
  });

  test("deletes runtime dirs of removed worktrees only", async () => {
    const live = (await launch(worktree, "hello")).runtime;
    const dead = `${home}/run/tuicraft-factory-000000000000`;
    await mkdir(`${dead}/tuicraft`, { recursive: true });
    await symlink(`${home}/gone`, `${dead}/.factory-gitdir`);
    await launch(other, "[factory:qa] go");
    await expect(stat(dead)).rejects.toThrow();
    expect((await stat(`${live}/.factory-gitdir`)).isDirectory()).toBe(true);
  });
});
