import {
  test,
  expect,
  describe,
  mock,
  spyOn,
  beforeEach,
  afterEach,
} from "bun:test";
import { parseConfig } from "lib/config";
import { rm } from "node:fs/promises";
import type { Interface as ReadlineInterface } from "node:readline";

let answers: string[] = [];
const mockClose = mock(() => {});

function fakeCreateInterface(): ReadlineInterface {
  return {
    question: (_prompt: string, cb: (answer: string) => void) => {
      cb(answers.shift() ?? "");
    },
    close: mockClose,
  } as unknown as ReadlineInterface;
}

const tmpBase = `./tmp/setup-wizard-test-${Date.now()}`;
const cfgDir = `${tmpBase}/config/tuicraft`;
const cfgPath = `${cfgDir}/config.toml`;
const uid = process.getuid?.() ?? 0;

mock.module("lib/paths", () => ({
  configDir: () => cfgDir,
  runtimeDir: () => `${tmpBase}/tuicraft-${uid}`,
  stateDir: () => `${tmpBase}/state/tuicraft`,
  socketPath: () => `${tmpBase}/tuicraft-${uid}/sock`,
  pidPath: () => `${tmpBase}/tuicraft-${uid}/pid`,
  configPath: () => cfgPath,
  logPath: () => `${tmpBase}/state/tuicraft/session.log`,
}));

const { runSetupWizard, runSetup } = await import("cli/setup");

beforeEach(() => {
  answers = [];
  mockClose.mockClear();
});

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true });
});

describe("runSetupWizard", () => {
  test("collects all fields and returns config", async () => {
    answers = ["testaccount", "testpass", "Testchar", "myhost", "1234", "7"];
    const cfg = await runSetupWizard(fakeCreateInterface as never);
    expect(cfg).toEqual({
      account: "testaccount",
      password: "testpass",
      character: "Testchar",
      host: "myhost",
      port: 1234,
      language: 7,
      timeout_minutes: 30,
    });
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  test("uses fallback values when answers are empty", async () => {
    answers = ["acc", "pass", "Char", "", "", ""];
    const cfg = await runSetupWizard(fakeCreateInterface as never);
    expect(cfg.host).toBe("t1");
    expect(cfg.port).toBe(3724);
    expect(cfg.language).toBe(1);
  });
});

describe("runSetup", () => {
  test("writes config file when flags present", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      await runSetup(["--account", "a", "--password", "b", "--character", "C"]);
      const content = await Bun.file(cfgPath).text();
      const cfg = parseConfig(content);
      expect(cfg.account).toBe("a");
      expect(cfg.password).toBe("b");
      expect(cfg.character).toBe("C");
    } finally {
      logSpy.mockRestore();
    }
  });

  test("uses wizard and writes config when no flags present", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      answers = ["wizacc", "wizpass", "WizChar", "wizhost", "9999", "7"];
      await runSetup([], fakeCreateInterface as never);
      const content = await Bun.file(cfgPath).text();
      const cfg = parseConfig(content);
      expect(cfg.account).toBe("wizacc");
      expect(cfg.host).toBe("wizhost");
      expect(cfg.port).toBe(9999);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("prints config path after saving", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      answers = ["a", "b", "C", "", "", ""];
      await runSetup([], fakeCreateInterface as never);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0]![0]).toContain("config.toml");
    } finally {
      logSpy.mockRestore();
    }
  });
});
