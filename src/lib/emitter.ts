export type Unsubscribe = () => void;

export class Emitter<Args extends unknown[]> {
  private listeners: ((...args: Args) => void)[] = [];
  private readonly onError: (error: unknown) => void;

  constructor(
    onError: (error: unknown) => void = (error) => {
      throw error;
    },
  ) {
    this.onError = onError;
  }

  get size(): number {
    return this.listeners.length;
  }

  subscribe(listener: (...args: Args) => void): Unsubscribe {
    const entry = (...args: Args): void => listener(...args);
    this.listeners = [...this.listeners, entry];
    return () => {
      this.listeners = this.listeners.filter((l) => l !== entry);
    };
  }

  emit(...args: Args): void {
    const failures: unknown[] = [];
    for (const listener of this.listeners) {
      try {
        listener(...args);
      } catch (error) {
        failures.push(error);
      }
    }
    for (const error of failures) this.onError(error);
  }

  clear(): void {
    this.listeners = [];
  }
}
