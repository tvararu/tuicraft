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
  private friends: Map<bigint, FriendEntry>;
  private listener?: (event: FriendEvent) => void;

  constructor() {
    this.friends = new Map();
  }

  onEvent(cb: (event: FriendEvent) => void): void {
    this.listener = cb;
  }

  set(entries: FriendEntry[]): void {
    this.friends.clear();
    for (const entry of entries) {
      this.friends.set(entry.guid, { ...entry });
    }
    this.listener?.({
      type: "friend-list",
      friends: [...this.friends.values()],
    });
  }

  add(entry: FriendEntry): void {
    const copy = { ...entry };
    this.friends.set(copy.guid, copy);
    this.listener?.({ type: "friend-added", friend: copy });
  }

  update(guid: bigint, fields: FriendUpdateFields): void {
    const entry = this.friends.get(guid);
    if (!entry) return;

    Object.assign(entry, fields);

    if (entry.status === 0) {
      this.listener?.({ type: "friend-offline", guid, name: entry.name });
    } else {
      this.listener?.({ type: "friend-online", friend: entry });
    }
  }

  remove(guid: bigint): void {
    const entry = this.friends.get(guid);
    if (!entry) return;

    this.friends.delete(guid);
    this.listener?.({ type: "friend-removed", guid, name: entry.name });
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
