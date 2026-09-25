import { homedir, tmpdir } from "node:os";

export type Paths = {
  configDir: string;
  configPath: string;
  logPath: string;
  pidPath: string;
  runtimeDir: string;
  socketPath: string;
  stateDir: string;
};

export type PathEnv = Record<string, string | undefined>;

export function resolvePaths(env: PathEnv = Bun.env): Paths {
  const configDir = `${env["XDG_CONFIG_HOME"] || `${homedir()}/.config`}/tuicraft`;
  const runtimeBase = env["XDG_RUNTIME_DIR"];
  const runtimeDir = runtimeBase
    ? `${runtimeBase}/tuicraft`
    : `${tmpdir()}/tuicraft-${process.getuid?.() ?? 0}`;
  const stateDir = `${env["XDG_STATE_HOME"] || `${homedir()}/.local/state`}/tuicraft`;
  return {
    configDir,
    configPath: `${configDir}/config.toml`,
    logPath: `${stateDir}/session.log`,
    pidPath: `${runtimeDir}/pid`,
    runtimeDir,
    socketPath: `${runtimeDir}/sock`,
    stateDir,
  };
}
