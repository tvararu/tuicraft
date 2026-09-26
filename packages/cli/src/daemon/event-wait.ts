import { waitUnlessAborted } from "@tuicraft/core/lib/abort";
import type { RingBuffer } from "#lib/ring-buffer";

export type IpcSocket = {
  write: (data: string | Uint8Array) => number;
  end: () => void;
};

export function writeLines(socket: IpcSocket, lines: string[]): void {
  for (const line of lines) socket.write(`${line}\n`);
  socket.write("\n");
}

type WaitContext<E> = {
  events: RingBuffer<E>;
  socket: IpcSocket;
  abort?: AbortSignal;
};

type Format<E> = (entries: E[]) => string[];

function send(socket: IpcSocket, lines: string[]): false {
  writeLines(socket, lines);
  return false;
}

export function readWait<E>(
  ctx: WaitContext<E>,
  { ms, since }: { ms: number; since?: number },
  format: Format<E>,
): Promise<false> {
  const { promise, resolve } = Promise.withResolvers<false>();
  const collect = () =>
    format(since === undefined ? ctx.events.drain() : ctx.events.take(since));
  const ready = collect();
  if (ready.length > 0 || ms === 0)
    return Promise.resolve(send(ctx.socket, ready));
  if (ctx.abort?.aborted) return Promise.resolve(false);
  const finish = (lines: string[] | undefined) => {
    clearTimeout(timer);
    unsubscribe();
    ctx.abort?.removeEventListener("abort", onAbort);
    if (lines) send(ctx.socket, lines);
    resolve(false);
  };
  const onAbort = () => finish(undefined);
  const timer = setTimeout(() => finish([]), ms);
  const unsubscribe = ctx.events.subscribe(() => {
    const lines = collect();
    if (lines.length > 0) finish(lines);
  });
  ctx.abort?.addEventListener("abort", onAbort, { once: true });
  return promise;
}

export async function tailWait<E>(
  ctx: WaitContext<E>,
  ms: number,
  format: Format<E>,
): Promise<false> {
  const start = ctx.events.writePos;
  const aborted = await waitUnlessAborted(ms, ctx.abort);
  if (aborted) return false;
  writeLines(ctx.socket, format(ctx.events.slice(start)));
  return false;
}
