import { describe, expect, jest, test } from "bun:test";
import { abortable, abortReason, bounded, pause } from "#lib/abort";

describe("abortReason", () => {
  test("keeps the signal's own abort error", () => {
    const controller = new AbortController();
    controller.abort();
    expect(abortReason(controller.signal)).toBe(controller.signal.reason);
  });

  test("makes an abort error when the signal has another reason", () => {
    const controller = new AbortController();
    controller.abort("halt");
    expect(abortReason(controller.signal).name).toBe("AbortError");
  });
});

describe("abortable", () => {
  test("rejects when the signal aborts first", async () => {
    const controller = new AbortController();
    const pending = abortable(new Promise(() => {}), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("bounded", () => {
  test("rejects with the timeout reason", async () => {
    jest.useFakeTimers();
    try {
      const pending = bounded(
        new Promise(() => {}),
        new AbortController().signal,
        100,
        "slow",
      );
      jest.advanceTimersByTime(100);
      await expect(pending).rejects.toThrow("slow");
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("pause", () => {
  test("resolves after the delay", async () => {
    jest.useFakeTimers();
    try {
      const pending = pause(50, new AbortController().signal);
      jest.advanceTimersByTime(50);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  test("rejects on abort", async () => {
    const controller = new AbortController();
    const pending = pause(10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
