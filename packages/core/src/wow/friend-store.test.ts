import { describe, expect, test } from "bun:test";
import { must } from "#test-support/must";
import {
  type FriendEntry,
  type FriendEvent,
  FriendStore,
} from "#wow/friend-store";

function makeFriend(overrides: Partial<FriendEntry> = {}): FriendEntry {
  return {
    guid: 1n,
    name: "Thrall",
    note: "",
    status: 1,
    area: 10,
    level: 80,
    playerClass: 7,
    ...overrides,
  };
}

describe("FriendStore", () => {
  test("set() replaces all entries and fires friend-list event", () => {
    const store = new FriendStore();
    const events: FriendEvent[] = [];
    store.onEvent((e) => events.push(e));

    const friends = [
      makeFriend({ guid: 1n, name: "Thrall" }),
      makeFriend({ guid: 2n, name: "Jaina" }),
    ];
    store.set(friends);

    expect(store.all()).toHaveLength(2);
    expect(events).toHaveLength(1);
    const event = must(events[0]);
    expect(event.type).toBe("friend-list");
    if (event.type === "friend-list") {
      expect(event.friends).toHaveLength(2);
    }
  });

  test("set() clears previous entries", () => {
    const store = new FriendStore();
    store.set([makeFriend({ guid: 1n, name: "Thrall" })]);
    store.set([makeFriend({ guid: 2n, name: "Jaina" })]);

    expect(store.all()).toHaveLength(1);
    expect(must(store.all()[0]).name).toBe("Jaina");
  });

  test("update() modifies existing entry and fires friend-online event", () => {
    const store = new FriendStore();
    const events: FriendEvent[] = [];
    store.set([makeFriend({ guid: 1n, name: "Thrall", status: 0 })]);
    store.onEvent((e) => events.push(e));

    store.update(1n, { status: 1, area: 20 });

    const all = store.all();
    expect(must(all[0]).status).toBe(1);
    expect(must(all[0]).area).toBe(20);
    expect(events).toHaveLength(1);
    const event = must(events[0]);
    expect(event.type).toBe("friend-online");
    if (event.type === "friend-online") {
      expect(event.friend.guid).toBe(1n);
    }
  });

  test("update() to offline fires friend-offline event", () => {
    const store = new FriendStore();
    const events: FriendEvent[] = [];
    store.set([makeFriend({ guid: 1n, name: "Thrall", status: 1 })]);
    store.onEvent((e) => events.push(e));

    store.update(1n, { status: 0 });

    expect(events).toHaveLength(1);
    const event = must(events[0]);
    expect(event.type).toBe("friend-offline");
    if (event.type === "friend-offline") {
      expect(event.guid).toBe(1n);
      expect(event.name).toBe("Thrall");
    }
  });

  test("update() ignores unknown guid", () => {
    const store = new FriendStore();
    const events: FriendEvent[] = [];
    store.onEvent((e) => events.push(e));

    store.update(999n, { status: 1 });

    expect(events).toHaveLength(0);
  });

  test("add() inserts new entry and fires friend-added event", () => {
    const store = new FriendStore();
    const events: FriendEvent[] = [];
    store.onEvent((e) => events.push(e));

    const friend = makeFriend({ guid: 1n, name: "Thrall" });
    store.add(friend);

    expect(store.all()).toHaveLength(1);
    expect(events).toHaveLength(1);
    const event = must(events[0]);
    expect(event.type).toBe("friend-added");
    if (event.type === "friend-added") {
      expect(event.friend.guid).toBe(1n);
    }
  });

  test("remove() deletes entry and fires friend-removed event", () => {
    const store = new FriendStore();
    const events: FriendEvent[] = [];
    store.set([makeFriend({ guid: 1n, name: "Thrall" })]);
    store.onEvent((e) => events.push(e));

    store.remove(1n);

    expect(store.all()).toHaveLength(0);
    expect(events).toHaveLength(1);
    const event = must(events[0]);
    expect(event.type).toBe("friend-removed");
    if (event.type === "friend-removed") {
      expect(event.guid).toBe(1n);
      expect(event.name).toBe("Thrall");
    }
  });

  test("remove() ignores unknown guid", () => {
    const store = new FriendStore();
    const events: FriendEvent[] = [];
    store.onEvent((e) => events.push(e));

    store.remove(999n);

    expect(events).toHaveLength(0);
  });

  test("setName() updates name on matching entry", () => {
    const store = new FriendStore();
    store.set([makeFriend({ guid: 1n, name: "Thrall" })]);

    store.setName(1n, "Go'el");

    expect(must(store.all()[0]).name).toBe("Go'el");
  });

  test("findByName() returns entry by case-insensitive name", () => {
    const store = new FriendStore();
    store.set([makeFriend({ guid: 1n, name: "Thrall" })]);

    expect(store.findByName("thrall")).toBeDefined();
    expect(store.findByName("THRALL")).toBeDefined();
    expect(store.findByName("Thrall")).toBeDefined();
    expect(must(store.findByName("thrall")).guid).toBe(1n);
  });

  test("findByName() returns undefined for unknown name", () => {
    const store = new FriendStore();
    store.set([makeFriend({ guid: 1n, name: "Thrall" })]);

    expect(store.findByName("Jaina")).toBeUndefined();
  });

  test("all() returns sorted by name", () => {
    const store = new FriendStore();
    store.set([
      makeFriend({ guid: 1n, name: "Zul'jin" }),
      makeFriend({ guid: 2n, name: "Arthas" }),
      makeFriend({ guid: 3n, name: "Jaina" }),
    ]);

    const all = store.all();
    expect(must(all[0]).name).toBe("Arthas");
    expect(must(all[1]).name).toBe("Jaina");
    expect(must(all[2]).name).toBe("Zul'jin");
  });

  test("entries are stored as copies", () => {
    const store = new FriendStore();
    const original = makeFriend({ guid: 1n, name: "Thrall" });
    store.add(original);

    original.name = "Mutated";
    expect(must(store.all()[0]).name).toBe("Thrall");
  });
});
