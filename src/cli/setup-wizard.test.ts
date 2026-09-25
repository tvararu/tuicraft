import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { rm } from "node:fs/promises";
import type { Interface as ReadlineInterface } from "node:readline";
import { runSetup, runSetupWizard } from "cli/setup";
import { parseConfig } from "lib/config";
import { pathsUnder } from "test/temp-paths";

let answers: string[] = [];
const mockClose = mock(() => {});

const fakeOutput = { write: () => true };

function fakeCreateInterface(): ReadlineInterface {
  return {
    close: mockClose,
    output: fakeOutput,
    question: (_prompt: string, cb: (answer: string) => void) => {
      cb(answers.shift() ?? "");
    },
  } as unknown as ReadlineInterface;
}

const tmpBase = `./tmp/setup-wizard-test-${Date.now()}`;
const paths = pathsUnder(tmpBase);
const cfgPath = paths.configPath;

beforeEach(() => {
  answers = [];
  mockClose.mockClear();
});

afterEach(async () => {
  await rm(tmpBase, { force: true, recursive: true });
});

describe("runSetupWizard", () => {
  test("collects all fields and returns config", async () => {
    answers = ["testaccount", "testpass", "Testchar", "myhost", "1234", "7"];
    const cfg = await runSetupWizard(fakeCreateInterface as never);
    expect(cfg).toEqual({
      account: "testaccount",
      character: "Testchar",
      host: "myhost",
      language: 7,
      password: "testpass",
      port: 1234,
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
      await runSetup(
        ["--account", "a", "--password", "b", "--character", "C"],
        undefined,
        paths,
      );
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
      await runSetup([], fakeCreateInterface as never, paths);
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
      await runSetup([], fakeCreateInterface as never, paths);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0]![0]).toContain("config.toml");
    } finally {
      logSpy.mockRestore();
    }
  });
});
