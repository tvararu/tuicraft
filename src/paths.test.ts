import { test, expect, describe } from "bun:test";
import {
  configDir,
  runtimeDir,
  stateDir,
  socketPath,
  pidPath,
  configPath,
} from "paths";

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

  test("socketPath returns runtimeDir/sock", () => {
    expect(socketPath()).toBe(`${runtimeDir()}/sock`);
  });

  test("pidPath returns runtimeDir/pid", () => {
    expect(pidPath()).toBe(`${runtimeDir()}/pid`);
  });

  test("configPath returns configDir/config.toml", () => {
    expect(configPath()).toBe(`${configDir()}/config.toml`);
  });
});
