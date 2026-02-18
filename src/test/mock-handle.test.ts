import { test, expect } from "bun:test";
import { createMockHandle } from "./mock-handle";

test("resolveClosed resolves closed promise", async () => {
  const handle = createMockHandle();
  handle.resolveClosed();
  await expect(handle.closed).resolves.toBeUndefined();
});

test("close resolves closed promise", async () => {
  const handle = createMockHandle();
  handle.close();
  await expect(handle.closed).resolves.toBeUndefined();
});

test("default who returns empty list", async () => {
  const handle = createMockHandle();
  await expect(handle.who({})).resolves.toEqual([]);
});

test("getLastChatMode defaults to say", () => {
  const handle = createMockHandle();
  expect(handle.getLastChatMode()).toEqual({ type: "say" });
});

test("setLastChatMode updates getLastChatMode", () => {
  const handle = createMockHandle();
  handle.setLastChatMode({ type: "whisper", target: "Xiara" });
  expect(handle.getLastChatMode()).toEqual({
    type: "whisper",
    target: "Xiara",
  });
});
