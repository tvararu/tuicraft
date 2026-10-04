import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { scratchDir } from "@peon/core/test-support/scratch";
import {
  ITEM_FLAGS_FILE,
  readItemFlags,
  recordItemFlags,
} from "#harness/grader/item-flags";
import { fakeExec, ok } from "#test-support/fake-exec";

const sides = (
  baseline: number[],
  final: number[],
  who = "",
): Record<string, unknown> => {
  const of = (items: number[]) => ({
    inventory: items.map((item, slot) => ({
      bag: 255,
      count: 1,
      item,
      name: `i${item}`,
      slot,
    })),
  });
  return {
    [`${who}baseline.json`]: of(baseline),
    [`${who}final.json`]: of(final),
  };
};

async function runDir(files: Record<string, unknown>) {
  const dir = `${await scratchDir("item-flags")}/run`;
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files))
    await writeFile(`${dir}/${name}`, JSON.stringify(body));
  return dir;
}

const report = (flags: Record<string, number | null>) =>
  ok(JSON.stringify({ flows: [{ flow: "item-flags", result: { flags } }] }));

describe("recordItemFlags", () => {
  test("asks the probe for the template flags of baseline items the final inventory lacks", async () => {
    const dir = await runDir(sides([2092, 5349, 1113], [2092]));
    const { calls, exec } = fakeExec(() =>
      report({ 1113: 2_097_154, 5349: 2_097_154 }),
    );
    await recordItemFlags({ account: "FAC0000000001", exec, runDir: dir });
    const argv = calls[0]?.argv ?? [];
    expect(argv).toContain("FAC0000000001");
    expect(argv).toContain("items=5349,1113");
    expect(await readItemFlags(dir)).toEqual({
      1113: 2_097_154,
      5349: 2_097_154,
    });
  });

  test("covers a partner's vanished items too", async () => {
    const dir = await runDir({
      ...sides([2092], [2092]),
      ...sides([1113], [], "partner1-"),
    });
    const { calls, exec } = fakeExec(() => report({ 1113: 2_097_154 }));
    await recordItemFlags({ account: "FAC0000000001", exec, runDir: dir });
    expect(calls[0]?.argv).toContain("items=1113");
  });

  test("makes no probe call when nothing vanished", async () => {
    const dir = await runDir(sides([2092], [2092, 5349]));
    const { calls, exec } = fakeExec(() => report({}));
    await recordItemFlags({ account: "FAC0000000001", exec, runDir: dir });
    expect(calls).toEqual([]);
    expect(await Bun.file(`${dir}/${ITEM_FLAGS_FILE}`).exists()).toBe(false);
  });

  test("a probe failure rejects and leaves no flags file", async () => {
    const dir = await runDir(sides([5349], []));
    const { exec } = fakeExec(() => ({
      code: 1,
      stderr: "login failed",
      stdout: "",
    }));
    await expect(
      recordItemFlags({ account: "FAC0000000001", exec, runDir: dir }),
    ).rejects.toThrow("login failed");
    expect(await readItemFlags(dir)).toEqual({});
  });

  test("a flow error rejects", async () => {
    const dir = await runDir(sides([5349], []));
    const { exec } = fakeExec(() =>
      ok(JSON.stringify({ flows: [{ error: "item_query_timeout" }] })),
    );
    await expect(
      recordItemFlags({ account: "FAC0000000001", exec, runDir: dir }),
    ).rejects.toThrow("item_query_timeout");
  });

  test("items the server has no template for stay unflagged", async () => {
    const dir = await runDir(sides([5349], []));
    const { exec } = fakeExec(() => report({ 5349: null }));
    await recordItemFlags({ account: "FAC0000000001", exec, runDir: dir });
    expect(await readItemFlags(dir)).toEqual({});
  });
});
