import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { factoryStateDir } from "#factory/config";
import { fetchIssues, type Issue } from "#factory/github";

export const issueCacheMs = 30_000;
export const lockStaleMs = 60_000;
const lockWaitMs = 20_000;
const lockPollMs = 200;

type Cached = { at: number; issues: Issue[] };

export function issueCacheFile(): string {
  return `${factoryStateDir()}/issues.json`;
}

async function readCache(file: string): Promise<Cached | null> {
  const handle = Bun.file(file);
  if (!(await handle.exists())) return null;
  try {
    return (await handle.json()) as Cached;
  } catch {
    return null;
  }
}

async function takeLock(lock: string): Promise<boolean> {
  const held = await stat(lock).catch(() => null);
  if (held && Date.now() - held.mtimeMs >= lockStaleMs)
    await rm(lock, { force: true });
  const handle = await open(lock, "wx").catch(() => null);
  await handle?.close();
  return handle !== null;
}

async function awaitFetch(
  lock: string,
  file: string,
  seen: number | null,
): Promise<{ issues: Issue[] } | { owned: boolean }> {
  const deadline = Date.now() + lockWaitMs;
  while (Date.now() < deadline) {
    await Bun.sleep(lockPollMs);
    const cached = await readCache(file);
    if (cached && cached.at !== seen) return { issues: cached.issues };
    if (await takeLock(lock)) return { owned: true };
  }
  return { owned: false };
}

export async function sharedIssues(
  now = Date.now(),
  file = issueCacheFile(),
  fetch: () => Promise<Issue[]> = fetchIssues,
): Promise<Issue[]> {
  const cached = await readCache(file);
  if (cached && now - cached.at >= 0 && now - cached.at < issueCacheMs)
    return cached.issues;
  await mkdir(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const seen = cached?.at ?? null;
  let owned = await takeLock(lock);
  if (!owned) {
    const waited = await awaitFetch(lock, file, seen);
    if ("issues" in waited) return waited.issues;
    owned = waited.owned;
  }
  try {
    const latest = owned ? await readCache(file) : null;
    if (latest && latest.at !== seen) return latest.issues;
    const issues = await fetch();
    const tmp = `${file}.${process.pid}`;
    await Bun.write(tmp, JSON.stringify({ at: now, issues }));
    await rename(tmp, file);
    return issues;
  } finally {
    if (owned) await rm(lock, { force: true });
  }
}
