import { test, expect, describe } from "bun:test";
import { configDir, runtimeDir, stateDir } from "paths";

describe("paths", () => {
  test("configDir defaults to ~/.config/tuicraft", () => {
    const dir = configDir();
    expect(dir).toMatch(/\/tuicraft$/);
    expect(dir).toContain("config");
  });

  test("runtimeDir includes uid", () => {
    const dir = runtimeDir();
    expect(dir).toMatch(/tuicraft-\d+$/);
  });

  test("stateDir defaults to ~/.local/state/tuicraft", () => {
    const dir = stateDir();
    expect(dir).toMatch(/\/tuicraft$/);
    expect(dir).toContain("state");
  });
});
