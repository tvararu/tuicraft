export type IgnoreEntry = {
  guid: bigint;
  name: string;
};

export type IgnoreEvent =
  | { type: "ignore-list"; entries: IgnoreEntry[] }
  | { type: "ignore-added"; entry: IgnoreEntry }
  | { type: "ignore-removed"; guid: bigint; name: string }
  | { type: "ignore-error"; result: number; name: string };

export class IgnoreStore {
  private ignored: Map<bigint, IgnoreEntry>;
  private guidLows: Set<number>;
  private listener?: (event: IgnoreEvent) => void;

  constructor() {
    this.ignored = new Map();
    this.guidLows = new Set();
  }

  onEvent(cb: (event: IgnoreEvent) => void): void {
    this.listener = cb;
  }

  set(entries: IgnoreEntry[]): void {
    this.ignored.clear();
    this.guidLows.clear();
    for (const entry of entries) {
      this.ignored.set(entry.guid, { ...entry });
      this.guidLows.add(Number(entry.guid & 0xffffffffn));
    }
    this.listener?.({
      type: "ignore-list",
      entries: [...this.ignored.values()],
    });
  }

  add(entry: IgnoreEntry): void {
    const copy = { ...entry };
    this.ignored.set(copy.guid, copy);
    this.guidLows.add(Number(copy.guid & 0xffffffffn));
    this.listener?.({ type: "ignore-added", entry: copy });
  }

  remove(guid: bigint): void {
    const entry = this.ignored.get(guid);
    if (!entry) return;
    this.ignored.delete(guid);
    this.guidLows.delete(Number(guid & 0xffffffffn));
    this.listener?.({ type: "ignore-removed", guid, name: entry.name });
  }

  setName(guid: bigint, name: string): void {
    const entry = this.ignored.get(guid);
    if (!entry) return;
    entry.name = name;
  }

  findByName(name: string): IgnoreEntry | undefined {
    const lower = name.toLowerCase();
    for (const entry of this.ignored.values()) {
      if (entry.name.toLowerCase() === lower) return entry;
    }
    return undefined;
  }

  has(guidLow: number): boolean {
    return this.guidLows.has(guidLow);
  }

  all(): IgnoreEntry[] {
    return [...this.ignored.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }
}
