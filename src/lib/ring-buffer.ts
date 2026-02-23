export class RingBuffer<T> {
  private items: (T | undefined)[];
  private capacity: number;
  private _writePos = 0;
  private cursor = 0;

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
    }
  }

  drain(): T[] {
    const result: T[] = [];
    for (let i = this.cursor; i < this._writePos; i++) {
      result.push(this.items[i % this.capacity] as T);
    }
    this.cursor = this._writePos;
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
