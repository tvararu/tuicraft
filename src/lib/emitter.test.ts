import { describe, expect, test } from "bun:test";
import { Emitter } from "lib/emitter";

describe("Emitter", () => {
  test("delivers every event to every subscriber in registration order", () => {
    const emitter = new Emitter<[string]>();
    const seen: string[] = [];
    emitter.subscribe((value) => seen.push(`a:${value}`));
    emitter.subscribe((value) => seen.push(`b:${value}`));
    emitter.emit("one");
    emitter.emit("two");
    expect(seen).toEqual(["a:one", "b:one", "a:two", "b:two"]);
  });

  test("unsubscribe stops delivery to that subscriber only", () => {
    const emitter = new Emitter<[number]>();
    const a: number[] = [];
    const b: number[] = [];
    const offA = emitter.subscribe((value) => a.push(value));
    emitter.subscribe((value) => b.push(value));
    emitter.emit(1);
    offA();
    offA();
    emitter.emit(2);
    expect(a).toEqual([1]);
    expect(b).toEqual([1, 2]);
    expect(emitter.size).toBe(1);
  });

  test("the same listener subscribed twice unsubscribes one registration at a time", () => {
    const emitter = new Emitter<[number]>();
    const seen: number[] = [];
    const listener = (value: number) => seen.push(value);
    const first = emitter.subscribe(listener);
    emitter.subscribe(listener);
    first();
    emitter.emit(7);
    expect(seen).toEqual([7]);
  });

  test("a throwing listener does not stop later listeners and reaches the error sink", () => {
    const errors: unknown[] = [];
    const emitter = new Emitter<[string]>((error) => errors.push(error));
    const seen: string[] = [];
    const boom = new Error("boom");
    emitter.subscribe(() => {
      throw boom;
    });
    emitter.subscribe((value) => seen.push(value));
    emitter.emit("event");
    expect(seen).toEqual(["event"]);
    expect(errors).toEqual([boom]);
  });

  test("without a sink the error is rethrown after every listener has run", () => {
    const emitter = new Emitter<[string]>();
    const seen: string[] = [];
    emitter.subscribe(() => {
      throw new Error("boom");
    });
    emitter.subscribe((value) => seen.push(value));
    expect(() => emitter.emit("event")).toThrow("boom");
    expect(seen).toEqual(["event"]);
  });

  test("subscriptions changed during emit take effect on the next emit", () => {
    const emitter = new Emitter<[number]>();
    const seen: string[] = [];
    let offB = (): void => {};
    emitter.subscribe((value) => {
      seen.push(`a:${value}`);
      offB();
      emitter.subscribe((late) => seen.push(`c:${late}`));
    });
    offB = emitter.subscribe((value) => seen.push(`b:${value}`));
    emitter.emit(1);
    expect(seen).toEqual(["a:1", "b:1"]);
  });

  test("clear detaches every listener", () => {
    const emitter = new Emitter<[number]>();
    const seen: number[] = [];
    emitter.subscribe((value) => seen.push(value));
    emitter.subscribe((value) => seen.push(value));
    emitter.clear();
    emitter.emit(1);
    expect(seen).toEqual([]);
    expect(emitter.size).toBe(0);
  });
});
