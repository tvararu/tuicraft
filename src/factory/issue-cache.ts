import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { factoryStateDir } from "factory/config";
import { fetchIssues, type Issue } from "factory/github";

export const issueCacheMs = 30_000;

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

export async function sharedIssues(
  now = Date.now(),
  file = issueCacheFile(),
  fetch: () => Promise<Issue[]> = fetchIssues,
): Promise<Issue[]> {
  const cached = await readCache(file);
  if (cached && now - cached.at >= 0 && now - cached.at < issueCacheMs)
    return cached.issues;
  const issues = await fetch();
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}`;
  await Bun.write(tmp, JSON.stringify({ at: now, issues }));
  await rename(tmp, file);
  return issues;
}
