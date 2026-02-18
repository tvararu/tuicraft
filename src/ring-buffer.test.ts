import { test, expect, describe } from "bun:test";
import { RingBuffer } from "ring-buffer";

describe("RingBuffer", () => {
  test("push and drain returns all items", () => {
    const buf = new RingBuffer<string>(10);
    buf.push("a");
    buf.push("b");
    expect(buf.drain()).toEqual(["a", "b"]);
  });

  test("drain is idempotent", () => {
    const buf = new RingBuffer<string>(10);
    buf.push("a");
    buf.drain();
    expect(buf.drain()).toEqual([]);
  });

  test("overflow drops oldest", () => {
    const buf = new RingBuffer<string>(3);
    buf.push("a");
    buf.push("b");
    buf.push("c");
    buf.push("d");
    expect(buf.drain()).toEqual(["b", "c", "d"]);
  });

  test("drain after overflow returns only unread", () => {
    const buf = new RingBuffer<string>(3);
    buf.push("a");
    buf.push("b");
    buf.drain();
    buf.push("c");
    buf.push("d");
    buf.push("e");
    buf.push("f");
    expect(buf.drain()).toEqual(["d", "e", "f"]);
  });
});
