import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { serializeConfig } from "@tuicraft/core/lib/config";
import {
  accountFiles,
  removeAccountFiles,
  writeWrapper,
  type XdgEnv,
  xdgEnv,
} from "#factory/soap-wrapper";

const account = "FAC6AB6E05F5A";
const character = "Fgklgoafpfk";
const fakeBun = `#!/usr/bin/env bash
printf '%s\\n' "$XDG_CONFIG_HOME" "$XDG_RUNTIME_DIR" "$XDG_STATE_HOME" "$@"
`;

let root: string;
let wrapper: string;
let env: XdgEnv;

async function writeAccountConfig(name: string, char: string): Promise<void> {
  await mkdir(`${env.XDG_CONFIG_HOME}/tuicraft`, { recursive: true });
  await writeFile(
    `${env.XDG_CONFIG_HOME}/tuicraft/config.toml`,
    `${serializeConfig({
      account: name,
      character: char,
      host: "t1",
      language: 1,
      password: "pw",
      port: 3724,
      timeout_minutes: 30,
    })}\n`,
  );
}

async function daemonPid(pid: number): Promise<void> {
  await mkdir(`${env.XDG_RUNTIME_DIR}/tuicraft`, { recursive: true });
  await writeFile(`${env.XDG_RUNTIME_DIR}/tuicraft/pid`, String(pid));
}

async function run(): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn([wrapper, "status", "--json"], {
    env: {
      ...Bun.env,
      PATH: `${root}/bin:${Bun.env["PATH"]}`,
      XDG_CONFIG_HOME: "/elsewhere/config",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, err, out };
}

function sleeper(configHome: string) {
  return Bun.spawn(["bash", "-c", "read -r -t 30 _", "--daemon"], {
    env: { ...Bun.env, XDG_CONFIG_HOME: configHome },
    stderr: "ignore",
    stdin: "pipe",
    stdout: "ignore",
  });
}

beforeEach(async () => {
  root = await mkdtemp(`${tmpdir()}/soap wrapper '`);
  await mkdir(`${root}/bin`);
  await writeFile(`${root}/bin/bun`, fakeBun, { mode: 0o755 });
  wrapper = await writeWrapper({ account, character, root });
  env = xdgEnv(accountFiles(root, account).dir);
});

afterEach(() => rm(root, { force: true, recursive: true }));

describe("tc wrapper", () => {
  test("runs the worktree CLI as the account's character", async () => {
    await writeAccountConfig(account, character);
    const { code, out, err } = await run();
    expect(code).toBe(0);
    expect(err).toBe(`tc-${account}: character ${character}\n`);
    expect(out.trimEnd().split("\n")).toEqual([
      env.XDG_CONFIG_HOME,
      env.XDG_RUNTIME_DIR,
      env.XDG_STATE_HOME,
      `${root}/packages/cli/src/main.ts`,
      "status",
      "--json",
    ]);
  });

  test("refuses a config that logs in another character", async () => {
    await writeAccountConfig(account, "Xiara");
    const { code, out, err } = await run();
    expect(code).not.toBe(0);
    expect(out).toBe("");
    expect(err).toContain(
      `logs in ${account}/Xiara, not ${account}/${character}`,
    );
  });

  test("refuses a config that logs in another account", async () => {
    await writeAccountConfig("x", character);
    const { code, out } = await run();
    expect(code).not.toBe(0);
    expect(out).toBe("");
  });

  test("refuses when the account's config is missing", async () => {
    const { code, out, err } = await run();
    expect(code).not.toBe(0);
    expect(out).toBe("");
    expect(err).toContain("no config at");
  });

  test("refuses a live daemon that logged in with another config", async () => {
    await writeAccountConfig(account, character);
    const other = sleeper("/home/someone/.config");
    try {
      await daemonPid(other.pid);
      const { code, out, err } = await run();
      expect(code).not.toBe(0);
      expect(out).toBe("");
      expect(err).toContain(`daemon ${other.pid} logged in with`);
    } finally {
      other.kill();
    }
  });

  test("accepts a live daemon that logged in with the account's config", async () => {
    await writeAccountConfig(account, character);
    const own = sleeper(env.XDG_CONFIG_HOME);
    try {
      await daemonPid(own.pid);
      expect((await run()).code).toBe(0);
    } finally {
      own.kill();
    }
  });
});

describe("removeAccountFiles", () => {
  test("removes the account's wrapper and dirs and nothing else", async () => {
    await writeAccountConfig(account, character);
    const sibling = "FAC6AB6E05F5B";
    await writeWrapper({ account: sibling, character, root });
    await removeAccountFiles(root, account);
    expect((await readdir(`${root}/tmp`)).sort()).toEqual([`tc-${sibling}`]);
    await removeAccountFiles(root, account);
  });
});
