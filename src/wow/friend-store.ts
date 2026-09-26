import { Emitter, type Unsubscribe } from "lib/emitter";
export type FriendEntry = {
  guid: bigint;
  name: string;
  note: string;
  status: number;
  area: number;
  level: number;
  playerClass: number;
};

export type FriendEvent =
  | { type: "friend-list"; friends: FriendEntry[] }
  | { type: "friend-online"; friend: FriendEntry }
  | { type: "friend-offline"; guid: bigint; name: string }
  | { type: "friend-added"; friend: FriendEntry }
  | { type: "friend-removed"; guid: bigint; name: string }
  | { type: "friend-error"; result: number; name: string };

type FriendUpdateFields = Partial<
  Pick<FriendEntry, "status" | "area" | "level" | "playerClass">
>;

export class FriendStore {
  private readonly friends: Map<bigint, FriendEntry>;
  private readonly events = new Emitter<[FriendEvent]>();

  constructor() {
    this.friends = new Map();
  }

  onEvent(cb: (event: FriendEvent) => void): Unsubscribe {
    return this.events.subscribe(cb);
  }

  set(entries: FriendEntry[]): void {
    this.friends.clear();
    for (const entry of entries) {
      this.friends.set(entry.guid, { ...entry });
    }
    this.events.emit({
      type: "friend-list",
      friends: [...this.friends.values()],
    });
  }

  add(entry: FriendEntry): void {
    const copy = { ...entry };
    this.friends.set(copy.guid, copy);
    this.events.emit({ type: "friend-added", friend: copy });
  }

  update(guid: bigint, fields: FriendUpdateFields): void {
    const entry = this.friends.get(guid);
    if (!entry) return;

    Object.assign(entry, fields);

    if (entry.status === 0) {
      this.events.emit({ type: "friend-offline", guid, name: entry.name });
    } else {
      this.events.emit({ type: "friend-online", friend: entry });
    }
  }

  remove(guid: bigint): void {
    const entry = this.friends.get(guid);
    if (!entry) return;

    this.friends.delete(guid);
    this.events.emit({ type: "friend-removed", guid, name: entry.name });
  }

  setName(guid: bigint, name: string): void {
    const entry = this.friends.get(guid);
    if (!entry) return;
    entry.name = name;
  }

  findByName(name: string): FriendEntry | undefined {
    const lower = name.toLowerCase();
    for (const entry of this.friends.values()) {
      if (entry.name.toLowerCase() === lower) return entry;
    }
    return undefined;
  }

  all(): FriendEntry[] {
    return [...this.friends.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }
}
