import { tmpdir, homedir } from "node:os";

export function configDir(): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  const base = xdg || `${homedir()}/.config`;
  return `${base}/tuicraft`;
}

export function runtimeDir(): string {
  const xdg = process.env["XDG_RUNTIME_DIR"];
  if (xdg) return `${xdg}/tuicraft`;
  return `${tmpdir()}/tuicraft-${process.getuid!()}`;
}

export function stateDir(): string {
  const xdg = process.env["XDG_STATE_HOME"];
  const base = xdg || `${homedir()}/.local/state`;
  return `${base}/tuicraft`;
}

export function socketPath(): string {
  return `${runtimeDir()}/sock`;
}

export function pidPath(): string {
  return `${runtimeDir()}/pid`;
}

export function configPath(): string {
  return `${configDir()}/config.toml`;
}

export function logPath(): string {
  return `${stateDir()}/session.log`;
}
