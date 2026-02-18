import { test, expect, describe, afterEach } from "bun:test";
import { SessionLog } from "session-log";
import { unlink } from "node:fs/promises";

const TEST_LOG = "./tmp/test-session.log";

afterEach(async () => {
  try {
    await unlink(TEST_LOG);
  } catch {}
});

describe("SessionLog", () => {
  test("append writes JSONL line", async () => {
    const log = new SessionLog(TEST_LOG);
    await log.append({ type: "SAY", sender: "Alice", message: "hi" });
    const content = await Bun.file(TEST_LOG).text();
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe("SAY");
    expect(parsed.sender).toBe("Alice");
    expect(parsed.message).toBe("hi");
    expect(parsed.timestamp).toBeDefined();
  });

  test("multiple appends create multiple lines", async () => {
    const log = new SessionLog(TEST_LOG);
    await log.append({ type: "SAY", sender: "A", message: "1" });
    await log.append({ type: "SAY", sender: "B", message: "2" });
    const lines = (await Bun.file(TEST_LOG).text()).trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});
