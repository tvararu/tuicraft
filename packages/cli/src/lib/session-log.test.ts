import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { ignoreFailure } from "@tuicraft/core/lib/ignore-failure";
import { SessionLog } from "#lib/session-log";

const TEST_LOG = "./tmp/test-session.log";

afterEach(async () => {
  await rm(TEST_LOG, { force: true });
});

describe("SessionLog", () => {
  test("append writes JSONL line", async () => {
    const log = new SessionLog(TEST_LOG);
    await log.append({ message: "hi", sender: "Alice", type: "SAY" });
    const content = await Bun.file(TEST_LOG).text();
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe("SAY");
    expect(parsed.sender).toBe("Alice");
    expect(parsed.message).toBe("hi");
    expect(parsed.timestamp).toBeDefined();
  });

  test("multiple appends create multiple lines", async () => {
    const log = new SessionLog(TEST_LOG);
    await log.append({ message: "1", sender: "A", type: "SAY" });
    await log.append({ message: "2", sender: "B", type: "SAY" });
    const lines = (await Bun.file(TEST_LOG).text()).trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  test("flush waits for unawaited appends and keeps their order", async () => {
    const log = new SessionLog(TEST_LOG);
    for (const message of ["1", "2", "3"])
      log.append({ message, sender: "A", type: "SAY" }).catch(ignoreFailure);
    await log.flush();
    const lines = (await Bun.file(TEST_LOG).text()).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line).message)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });
});
