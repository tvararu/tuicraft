import { test, expect, describe } from "bun:test";
import { RingBuffer } from "lib/ring-buffer";

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

  test("writePos starts at zero", () => {
    const buf = new RingBuffer<string>(10);
    expect(buf.writePos).toBe(0);
  });

  test("writePos advances on push", () => {
    const buf = new RingBuffer<string>(10);
    buf.push("a");
    buf.push("b");
    expect(buf.writePos).toBe(2);
  });

  test("slice returns items from position to writePos", () => {
    const buf = new RingBuffer<string>(10);
    buf.push("a");
    buf.push("b");
    buf.push("c");
    expect(buf.slice(1)).toEqual(["b", "c"]);
  });

  test("slice from zero returns all items", () => {
    const buf = new RingBuffer<string>(10);
    buf.push("a");
    buf.push("b");
    expect(buf.slice(0)).toEqual(["a", "b"]);
  });

  test("slice from writePos returns empty", () => {
    const buf = new RingBuffer<string>(10);
    buf.push("a");
    buf.push("b");
    expect(buf.slice(2)).toEqual([]);
  });

  test("slice clamps to oldest on overflow", () => {
    const buf = new RingBuffer<string>(3);
    buf.push("a");
    buf.push("b");
    buf.push("c");
    buf.push("d");
    expect(buf.slice(0)).toEqual(["b", "c", "d"]);
  });

  test("slice clamps stale snapshot evicted by overflow", () => {
    const buf = new RingBuffer<string>(3);
    buf.push("a");
    buf.push("b");
    const snapshot = buf.writePos;
    buf.push("c");
    buf.push("d");
    buf.push("e");
    expect(buf.slice(snapshot)).toEqual(["c", "d", "e"]);
  });

  test("slice is non-destructive", () => {
    const buf = new RingBuffer<string>(10);
    buf.push("a");
    buf.push("b");
    expect(buf.slice(0)).toEqual(["a", "b"]);
    expect(buf.slice(0)).toEqual(["a", "b"]);
  });

  test("slice does not affect drain cursor", () => {
    const buf = new RingBuffer<string>(10);
    buf.push("a");
    buf.push("b");
    buf.slice(0);
    expect(buf.drain()).toEqual(["a", "b"]);
  });
});
