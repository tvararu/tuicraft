import { afterEach, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { SessionLog } from "lib/session-log";

const TEST_LOG = "./tmp/test-session.log";

afterEach(async () => {
  try {
    await unlink(TEST_LOG);
  } catch {}
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
});
