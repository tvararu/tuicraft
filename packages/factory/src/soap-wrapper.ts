import { mkdir, rm, writeFile } from "node:fs/promises";

export type AccountFiles = { dir: string; wrapper: string };
export type WrapperSpec = { account: string; character: string; root: string };
export type XdgEnv = Record<
  "XDG_CONFIG_HOME" | "XDG_RUNTIME_DIR" | "XDG_STATE_HOME",
  string
>;

export function accountFiles(root: string, account: string): AccountFiles {
  return {
    dir: `${root}/tmp/factory-account-${account}`,
    wrapper: `${root}/tmp/tc-${account}`,
  };
}

export function xdgEnv(dir: string): XdgEnv {
  return {
    XDG_CONFIG_HOME: `${dir}/config`,
    XDG_RUNTIME_DIR: `${dir}/runtime`,
    XDG_STATE_HOME: `${dir}/state`,
  };
}

function quote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

export function wrapperScript({
  account,
  character,
  root,
}: WrapperSpec): string {
  const env = xdgEnv(accountFiles(root, account).dir);
  return `#!/usr/bin/env bash
set -euo pipefail
account=${quote(account)}
character=${quote(character)}
export XDG_CONFIG_HOME=${quote(env.XDG_CONFIG_HOME)}
export XDG_RUNTIME_DIR=${quote(env.XDG_RUNTIME_DIR)}
export XDG_STATE_HOME=${quote(env.XDG_STATE_HOME)}

refuse() {
  printf 'tc-%s: refusing to run: %s\\n' "$account" "$1" >&2
  exit 1
}

field() {
  sed -n "s/^$1 = \\"\\(.*\\)\\"$/\\1/p" "$config"
}

config=$XDG_CONFIG_HOME/tuicraft/config.toml
[[ -f $config ]] || refuse "no config at $config"
logs_in="$(field account)/$(field character)"
[[ $logs_in == "$account/$character" ]] ||
  refuse "$config logs in $logs_in, not $account/$character"

pidfile=$XDG_RUNTIME_DIR/tuicraft/pid
if [[ -f $pidfile ]]; then
  pid=$(<"$pidfile")
  if [[ $pid =~ ^[0-9]+$ && -r /proc/$pid/cmdline ]] &&
    tr '\\0' '\\n' <"/proc/$pid/cmdline" | grep -x -- --daemon >/dev/null; then
    daemon_config=$(tr '\\0' '\\n' <"/proc/$pid/environ" |
      sed -n 's/^XDG_CONFIG_HOME=//p')
    [[ $daemon_config == "$XDG_CONFIG_HOME" ]] ||
      refuse "daemon $pid logged in with the config in \${daemon_config:-the default XDG_CONFIG_HOME}, not $XDG_CONFIG_HOME"
  fi
fi

printf 'tc-%s: character %s\\n' "$account" "$character" >&2
exec bun ${quote(`${root}/packages/cli/src/main.ts`)} "$@"
`;
}

export async function writeWrapper(spec: WrapperSpec): Promise<string> {
  const { wrapper } = accountFiles(spec.root, spec.account);
  await mkdir(`${spec.root}/tmp`, { recursive: true });
  await writeFile(wrapper, wrapperScript(spec), { mode: 0o755 });
  return wrapper;
}

export async function removeAccountFiles(
  root: string,
  account: string,
): Promise<void> {
  const { dir, wrapper } = accountFiles(root, account);
  await Promise.all([
    rm(wrapper, { force: true }),
    rm(dir, { force: true, recursive: true }),
  ]);
}
