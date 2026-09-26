import type { IpcSocket } from "#daemon/event-wait";

export type SocketOutbox = IpcSocket & { flush: () => void };

const encoder = new TextEncoder();

export function socketOutbox(raw: IpcSocket): SocketOutbox {
  const pending: Uint8Array[] = [];
  let ending = false;
  let ended = false;
  function flush(): void {
    while (pending.length > 0) {
      const chunk = pending[0];
      if (chunk === undefined) break;
      const written = raw.write(chunk);
      if (written < chunk.length) {
        pending[0] = chunk.subarray(Math.max(written, 0));
        return;
      }
      pending.shift();
    }
    if (ending && !ended) {
      ended = true;
      raw.end();
    }
  }
  return {
    end() {
      ending = true;
      flush();
    },
    flush,
    write(data) {
      const bytes = typeof data === "string" ? encoder.encode(data) : data;
      pending.push(bytes);
      flush();
      return bytes.length;
    },
  };
}
