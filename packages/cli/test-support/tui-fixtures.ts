import type { PassThrough } from "node:stream";

export function writeLine(stream: PassThrough, line: string): void {
  stream.write(`${line}\n`);
}

export async function flush(turns = 1): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await Bun.sleep(0);
  }
}
