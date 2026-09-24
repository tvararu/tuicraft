import { describe, expect, jest, test } from "bun:test";
import { EventWaiter } from "wow/event-waiter";

const open = () => new AbortController().signal;

describe("next", () => {
  test("returns queued events in order", async () => {
    const waiter = new EventWaiter<number>();
    waiter.push(1);
    waiter.push(2);
    expect(await waiter.next(10, open())).toBe(1);
    expect(await waiter.next(10, open())).toBe(2);
  });

  test("waits for the next push", async () => {
    const waiter = new EventWaiter<number>();
    const pending = waiter.next(1000, open());
    waiter.push(7);
    expect(await pending).toBe(7);
  });

  test("keeps a second event pushed in the same tick", async () => {
    const waiter = new EventWaiter<number>();
    const pending = waiter.next(1000, open());
    waiter.push(1);
    waiter.push(2);
    expect(await pending).toBe(1);
    expect(await waiter.next(10, open())).toBe(2);
  });

  test("resolves undefined on timeout", async () => {
    jest.useFakeTimers();
    try {
      const pending = new EventWaiter<number>().next(100, open());
      jest.advanceTimersByTime(100);
      expect(await pending).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  test("rejects on abort", async () => {
    const controller = new AbortController();
    const pending = new EventWaiter<number>().next(1000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("find", () => {
  test("skips events that do not match and keeps them queued", async () => {
    const waiter = new EventWaiter<number>();
    waiter.push(1);
    const pending = waiter.find((event) => event > 5, 1000, open());
    waiter.push(3);
    waiter.push(9);
    expect(await pending).toBe(9);
    expect(await waiter.next(10, open())).toBe(1);
    expect(await waiter.next(10, open())).toBe(3);
  });
});
