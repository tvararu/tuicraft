import { test, expect, describe } from "bun:test";
import { parseSetupFlags } from "setup";

describe("parseSetupFlags", () => {
  test("extracts all flags", () => {
    const args = [
      "--account",
      "x",
      "--password",
      "y",
      "--character",
      "Xia",
      "--host",
      "t1",
      "--port",
      "3724",
    ];
    const cfg = parseSetupFlags(args);
    expect(cfg.account).toBe("x");
    expect(cfg.password).toBe("y");
    expect(cfg.character).toBe("Xia");
    expect(cfg.host).toBe("t1");
    expect(cfg.port).toBe(3724);
  });

  test("uses defaults for missing optional flags", () => {
    const args = ["--account", "x", "--password", "y", "--character", "Xia"];
    const cfg = parseSetupFlags(args);
    expect(cfg.host).toBe("t1");
    expect(cfg.port).toBe(3724);
    expect(cfg.language).toBe(1);
    expect(cfg.timeout_minutes).toBe(30);
  });

  test("throws if required flags missing", () => {
    expect(() => parseSetupFlags(["--account", "x"])).toThrow();
  });

  test("throws on invalid --port value", () => {
    expect(() =>
      parseSetupFlags([
        "--account",
        "x",
        "--password",
        "y",
        "--character",
        "Z",
        "--port",
        "abc",
      ]),
    ).toThrow("Invalid --port value: abc");
  });
});
