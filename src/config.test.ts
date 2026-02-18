import { test, expect, describe, afterEach, mock } from "bun:test";
import { parseConfig, serializeConfig, type Config } from "config";
import { rm } from "node:fs/promises";

const tmpBase = `./tmp/config-test-${Date.now()}`;

mock.module("paths", () => ({
  configPath: () => `${tmpBase}/config.toml`,
  configDir: () => tmpBase,
}));

describe("parseConfig", () => {
  test("parses string and number values", () => {
    const input = `account = "x"\npassword = "xwow2026"\ncharacter = "Z"\nport = 3724`;
    const cfg = parseConfig(input);
    expect(cfg.account).toBe("x");
    expect(cfg.password).toBe("xwow2026");
    expect(cfg.port).toBe(3724);
  });

  test("ignores blank lines and comments", () => {
    const input = `# comment\naccount = "x"\npassword = "y"\n\ncharacter = "Xia"`;
    const cfg = parseConfig(input);
    expect(cfg.account).toBe("x");
    expect(cfg.character).toBe("Xia");
  });

  test("uses defaults for missing keys", () => {
    const cfg = parseConfig(`account = "x"\npassword = "y"\ncharacter = "Z"`);
    expect(cfg.host).toBe("t1");
    expect(cfg.port).toBe(3724);
    expect(cfg.language).toBe(1);
    expect(cfg.timeout_minutes).toBe(30);
  });

  test("throws on missing account", () => {
    expect(() => parseConfig(`password = "y"\ncharacter = "Z"`)).toThrow(
      "Missing required config field: account",
    );
  });

  test("throws on missing password", () => {
    expect(() => parseConfig(`account = "x"\ncharacter = "Z"`)).toThrow(
      "Missing required config field: password",
    );
  });

  test("throws on missing character", () => {
    expect(() => parseConfig(`account = "x"\npassword = "y"`)).toThrow(
      "Missing required config field: character",
    );
  });
});

describe("serializeConfig", () => {
  test("round-trips through parse", () => {
    const cfg: Config = {
      account: "x",
      password: "xwow2026",
      character: "Xia",
      host: "t1",
      port: 3724,
      language: 1,
      timeout_minutes: 30,
    };
    const text = serializeConfig(cfg);
    const parsed = parseConfig(text);
    expect(parsed).toEqual(cfg);
  });
});

const sampleConfig: Config = {
  account: "testuser",
  password: "testpass",
  character: "Gandalf",
  host: "t1",
  port: 3724,
  language: 1,
  timeout_minutes: 30,
};

describe("readConfig", () => {
  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  test("throws when config file does not exist", async () => {
    const { readConfig } = await import("config");
    await expect(readConfig()).rejects.toThrow("No config found");
  });

  test("parses an existing config file", async () => {
    const { readConfig } = await import("config");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(tmpBase, { recursive: true });
    await Bun.write(
      `${tmpBase}/config.toml`,
      serializeConfig(sampleConfig) + "\n",
    );
    const cfg = await readConfig();
    expect(cfg).toEqual(sampleConfig);
  });
});

describe("writeConfig", () => {
  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  test("creates directory and writes config", async () => {
    const { writeConfig } = await import("config");
    await writeConfig(sampleConfig);
    const content = await Bun.file(`${tmpBase}/config.toml`).text();
    expect(content).toContain('account = "testuser"');
    expect(content).toContain('password = "testpass"');
    expect(content).toContain("port = 3724");
  });

  test("round-trips through writeConfig and readConfig", async () => {
    const { writeConfig, readConfig } = await import("config");
    await writeConfig(sampleConfig);
    const cfg = await readConfig();
    expect(cfg).toEqual(sampleConfig);
  });
});
