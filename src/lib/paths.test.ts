import { test, expect, describe } from "bun:test";
import { resolvePaths } from "lib/paths";

describe("resolvePaths", () => {
  test("honours XDG directories", () => {
    const paths = resolvePaths({
      XDG_CONFIG_HOME: "/cfg",
      XDG_RUNTIME_DIR: "/run/user/7",
      XDG_STATE_HOME: "/state",
    });
    expect(paths).toEqual({
      configDir: "/cfg/tuicraft",
      configPath: "/cfg/tuicraft/config.toml",
      logPath: "/state/tuicraft/session.log",
      pidPath: "/run/user/7/tuicraft/pid",
      runtimeDir: "/run/user/7/tuicraft",
      socketPath: "/run/user/7/tuicraft/sock",
      stateDir: "/state/tuicraft",
    });
  });

  test("falls back to home and a uid-scoped temp directory", () => {
    const paths = resolvePaths({});
    expect(paths.configDir).toMatch(/\/\.config\/tuicraft$/);
    expect(paths.stateDir).toMatch(/\/\.local\/state\/tuicraft$/);
    expect(paths.runtimeDir).toMatch(/\/tuicraft-\d+$/);
    expect(paths.socketPath).toBe(`${paths.runtimeDir}/sock`);
  });

  test("treats empty XDG values as unset", () => {
    const paths = resolvePaths({ XDG_CONFIG_HOME: "", XDG_STATE_HOME: "" });
    expect(paths.configDir).toMatch(/\/\.config\/tuicraft$/);
    expect(paths.stateDir).toMatch(/\/\.local\/state\/tuicraft$/);
  });
});
