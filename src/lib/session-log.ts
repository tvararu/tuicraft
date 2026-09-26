import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ignoreFailure } from "lib/ignore-failure";

export type LogEntry = {
  type: string;
  sender: string;
  message: string;
  channel?: string;
};

export class SessionLog {
  private readonly path: string;
  private tail: Promise<unknown>;

  constructor(path: string) {
    this.path = path;
    this.tail = mkdir(dirname(path), { recursive: true }).catch(ignoreFailure);
  }

  append(entry: LogEntry): Promise<void> {
    const line = `${JSON.stringify({ ...entry, timestamp: Date.now() })}\n`;
    const write = this.tail.then(() => appendFile(this.path, line));
    this.tail = write.catch(ignoreFailure);
    return write;
  }

  async flush(): Promise<void> {
    await this.tail;
  }
}
