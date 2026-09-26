import { describe, expect, test } from "bun:test";
import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Issue } from "factory/github";
import { issueCacheMs, lockStaleMs, sharedIssues } from "factory/issue-cache";
import { issue } from "test/factory-fixtures";

async function counter(batches: Issue[][]) {
  const file = `${await mkdtemp(`${tmpdir()}/issue-cache-`)}/state/issues.json`;
  let calls = 0;
  const fetch = async () => batches[calls++] ?? [];
  return { calls: () => calls, fetch, file };
}

describe("sharedIssues", () => {
  test("reuses a fetch younger than the cache window", async () => {
    const c = await counter([[issue(1, "ready")], [issue(2, "ready")]]);
    await sharedIssues(1000, c.file, c.fetch);
    const again = await sharedIssues(1000 + issueCacheMs - 1, c.file, c.fetch);
    expect(again.map((i) => i.number)).toEqual([1]);
    expect(c.calls()).toBe(1);
  });

  test("refetches once the window has passed", async () => {
    const c = await counter([[issue(1, "ready")], [issue(2, "ready")]]);
    await sharedIssues(1000, c.file, c.fetch);
    const later = await sharedIssues(1000 + issueCacheMs, c.file, c.fetch);
    expect(later.map((i) => i.number)).toEqual([2]);
    expect(c.calls()).toBe(2);
  });

  test("refetches when the cache is from the future", async () => {
    const c = await counter([[issue(1, "ready")], [issue(2, "ready")]]);
    await sharedIssues(50_000, c.file, c.fetch);
    await sharedIssues(1000, c.file, c.fetch);
    expect(c.calls()).toBe(2);
  });

  test("refetches over a corrupt cache file", async () => {
    const c = await counter([[issue(3, "ready")]]);
    await Bun.write(c.file, "{not json");
    const got = await sharedIssues(1000, c.file, c.fetch);
    expect(got.map((i) => i.number)).toEqual([3]);
  });

  test("prechecks that start together share one fetch", async () => {
    const c = await counter([[issue(4, "ready")], [issue(5, "ready")]]);
    const got = await Promise.all(
      [1000, 1001, 1002].map((now) => sharedIssues(now, c.file, c.fetch)),
    );
    expect(got.map((list) => list.map((i) => i.number))).toEqual([
      [4],
      [4],
      [4],
    ]);
    expect(c.calls()).toBe(1);
  });

  test("a failed fetch lets the next precheck fetch", async () => {
    const c = await counter([[issue(6, "ready")]]);
    const failing = () => Promise.reject(new Error("rate limit exceeded"));
    await expect(sharedIssues(1000, c.file, failing)).rejects.toThrow(
      "rate limit exceeded",
    );
    const got = await sharedIssues(1000, c.file, c.fetch);
    expect(got.map((i) => i.number)).toEqual([6]);
  });

  test("takes over a lock left by a killed precheck", async () => {
    const c = await counter([[issue(7, "ready")]]);
    await Bun.write(c.file, "{not json");
    const lock = `${c.file}.lock`;
    await writeFile(lock, "");
    const stale = (Date.now() - lockStaleMs - 1000) / 1000;
    await utimes(lock, stale, stale);
    const got = await sharedIssues(1000, c.file, c.fetch);
    expect(got.map((i) => i.number)).toEqual([7]);
    expect(c.calls()).toBe(1);
  });
});
