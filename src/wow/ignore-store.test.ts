import { test, expect, describe } from "bun:test";
import { IgnoreStore, type IgnoreEvent } from "wow/ignore-store";

describe("IgnoreStore", () => {
  test("starts empty", () => {
    const store = new IgnoreStore();
    expect(store.all()).toEqual([]);
  });

  test("set replaces all entries and fires ignore-list event", () => {
    const store = new IgnoreStore();
    const events: IgnoreEvent[] = [];
    store.onEvent((e) => events.push(e));

    store.set([
      { guid: 1n, name: "Spammer" },
      { guid: 2n, name: "Troll" },
    ]);

    expect(store.all()).toHaveLength(2);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("ignore-list");
  });

  test("set clears previous entries", () => {
    const store = new IgnoreStore();
    store.set([{ guid: 1n, name: "Old" }]);
    store.set([{ guid: 2n, name: "New" }]);

    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]!.name).toBe("New");
  });

  test("add inserts entry and fires ignore-added event", () => {
    const store = new IgnoreStore();
    const events: IgnoreEvent[] = [];
    store.onEvent((e) => events.push(e));

    store.add({ guid: 1n, name: "Spammer" });

    expect(store.all()).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("ignore-added");
  });

  test("remove deletes entry and fires ignore-removed event", () => {
    const store = new IgnoreStore();
    const events: IgnoreEvent[] = [];
    store.set([{ guid: 1n, name: "Spammer" }]);
    store.onEvent((e) => events.push(e));

    store.remove(1n);

    expect(store.all()).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("ignore-removed");
    if (events[0]!.type === "ignore-removed") {
      expect(events[0]!.name).toBe("Spammer");
    }
  });

  test("remove does nothing for unknown guid", () => {
    const store = new IgnoreStore();
    const events: IgnoreEvent[] = [];
    store.onEvent((e) => events.push(e));

    store.remove(999n);

    expect(events).toHaveLength(0);
  });

  test("setName updates entry name", () => {
    const store = new IgnoreStore();
    store.set([{ guid: 1n, name: "" }]);

    store.setName(1n, "Resolved");

    expect(store.all()[0]!.name).toBe("Resolved");
  });

  test("setName does nothing for unknown guid", () => {
    const store = new IgnoreStore();
    store.setName(999n, "Nope");
    expect(store.all()).toHaveLength(0);
  });

  test("findByName finds case-insensitive match", () => {
    const store = new IgnoreStore();
    store.set([{ guid: 1n, name: "Spammer" }]);

    expect(store.findByName("spammer")).toBeDefined();
    expect(store.findByName("SPAMMER")).toBeDefined();
    expect(store.findByName("Spammer")).toBeDefined();
  });

  test("findByName returns undefined for no match", () => {
    const store = new IgnoreStore();
    store.set([{ guid: 1n, name: "Spammer" }]);

    expect(store.findByName("Nobody")).toBeUndefined();
  });

  test("has matches by guid low bits", () => {
    const store = new IgnoreStore();
    store.set([{ guid: 0x1_00000005n, name: "Spammer" }]);

    expect(store.has(5)).toBe(true);
    expect(store.has(6)).toBe(false);
  });

  test("all returns sorted by name", () => {
    const store = new IgnoreStore();
    store.set([
      { guid: 1n, name: "Zed" },
      { guid: 2n, name: "Alpha" },
      { guid: 3n, name: "Middle" },
    ]);

    const names = store.all().map((e) => e.name);
    expect(names).toEqual(["Alpha", "Middle", "Zed"]);
  });

  test("set copies entries to prevent mutation", () => {
    const store = new IgnoreStore();
    const entry = { guid: 1n, name: "Original" };
    store.set([entry]);
    entry.name = "Mutated";

    expect(store.all()[0]!.name).toBe("Original");
  });

  test("add copies entry to prevent mutation", () => {
    const store = new IgnoreStore();
    const entry = { guid: 1n, name: "Original" };
    store.add(entry);
    entry.name = "Mutated";

    expect(store.all()[0]!.name).toBe("Original");
  });

  test("works without listener", () => {
    const store = new IgnoreStore();
    store.set([{ guid: 1n, name: "Test" }]);
    store.add({ guid: 2n, name: "Test2" });
    store.remove(1n);
    expect(store.all()).toHaveLength(1);
  });
});
