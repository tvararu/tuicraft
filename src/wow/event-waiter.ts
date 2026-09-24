import { abortable } from "lib/abort";

export class EventWaiter<E> {
  private readonly queue: E[] = [];
  private wake: (() => void) | undefined;

  push(event: E): void {
    this.queue.push(event);
    this.wake?.();
  }

  next(timeoutMs: number, signal: AbortSignal): Promise<E | undefined> {
    return this.take(() => this.queue.shift(), timeoutMs, signal);
  }

  find(
    predicate: (event: E) => boolean,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<E | undefined> {
    const pick = () => {
      const index = this.queue.findIndex(predicate);
      return index === -1 ? undefined : this.queue.splice(index, 1)[0];
    };
    return this.take(pick, timeoutMs, signal);
  }

  private async take(
    pick: () => E | undefined,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<E | undefined> {
    signal.throwIfAborted();
    const queued = pick();
    if (queued !== undefined) return queued;
    const waiter = Promise.withResolvers<E | undefined>();
    let settled = false;
    const settle = (event: E | undefined) => {
      settled = true;
      clearTimeout(timer);
      this.wake = undefined;
      waiter.resolve(event);
    };
    const timer = setTimeout(() => settle(undefined), timeoutMs);
    this.wake = () => {
      const event = pick();
      if (event !== undefined) settle(event);
    };
    try {
      return await abortable(waiter.promise, signal);
    } finally {
      if (!settled) settle(undefined);
    }
  }
}
