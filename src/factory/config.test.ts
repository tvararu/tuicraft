import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { paceFile, readPace } from "factory/config";

let counter = 0;
let dir = "";

beforeEach(async () => {
  counter += 1;
  dir = `${process.cwd()}/tmp/factory-pace-${Date.now()}-${counter}`;
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("readPace", () => {
  test("is default when the file is absent", async () => {
    expect(await readPace(paceFile(dir))).toBe("default");
  });

  test("reads the persisted level", async () => {
    for (const pace of ["pause", "max"] as const) {
      await Bun.write(paceFile(dir), `${pace}\n`);
      expect(await readPace(paceFile(dir))).toBe(pace);
    }
  });

  test("rejects an unknown level instead of guessing", async () => {
    await Bun.write(paceFile(dir), "turbo");
    await expect(readPace(paceFile(dir))).rejects.toThrow(
      'unknown pace "turbo"',
    );
  });
});
