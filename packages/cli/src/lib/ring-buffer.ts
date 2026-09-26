export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private readonly capacity: number;
  private _writePos = 0;
  private cursor = 0;
  private readonly taken = new Set<number>();
  private readonly listeners = new Set<() => void>();

  constructor(capacity: number) {
    this.capacity = capacity;
    this.items = new Array<T | undefined>(capacity);
  }

  get writePos(): number {
    return this._writePos;
  }

  push(item: T): void {
    this.items[this._writePos % this.capacity] = item;
    this._writePos++;
    const oldest = this._writePos - this.capacity;
    if (this.cursor < oldest) {
      this.cursor = oldest;
      this.taken.delete(oldest - 1);
    }
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  drain(): T[] {
    const result: T[] = [];
    for (let i = this.cursor; i < this._writePos; i++) {
      if (!this.taken.has(i)) result.push(this.items[i % this.capacity] as T);
    }
    this.cursor = this._writePos;
    this.taken.clear();
    return result;
  }

  take(from: number): T[] {
    const result: T[] = [];
    for (let i = Math.max(from, this.cursor); i < this._writePos; i++) {
      if (this.taken.has(i)) continue;
      this.taken.add(i);
      result.push(this.items[i % this.capacity] as T);
    }
    return result;
  }

  slice(from: number): T[] {
    const oldest = Math.max(0, this._writePos - this.capacity);
    const start = Math.max(from, oldest);
    const result: T[] = [];
    for (let i = start; i < this._writePos; i++) {
      result.push(this.items[i % this.capacity] as T);
    }
    return result;
  }
}
