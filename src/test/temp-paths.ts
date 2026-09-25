import { type Paths, resolvePaths } from "lib/paths";

export function pathsUnder(base: string): Paths {
  return resolvePaths({
    XDG_CONFIG_HOME: `${base}/config`,
    XDG_RUNTIME_DIR: `${base}/runtime`,
    XDG_STATE_HOME: `${base}/state`,
  });
}
