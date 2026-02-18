export class RingBuffer<T> {
  private items: (T | undefined)[];
  private capacity: number;
  private writePos = 0;
  private cursor = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.items = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    this.items[this.writePos % this.capacity] = item;
    this.writePos++;
    const oldest = this.writePos - this.capacity;
    if (this.cursor < oldest) {
      this.cursor = oldest;
    }
  }

  drain(): T[] {
    const result: T[] = [];
    for (let i = this.cursor; i < this.writePos; i++) {
      result.push(this.items[i % this.capacity] as T);
    }
    this.cursor = this.writePos;
    return result;
  }
}
