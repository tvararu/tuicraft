import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type LogEntry = {
  type: string;
  sender: string;
  message: string;
  channel?: string;
};

export class SessionLog {
  private ready: Promise<void>;

  constructor(private readonly path: string) {
    this.ready = mkdir(dirname(path), { recursive: true }).then(() => {});
  }

  async append(entry: LogEntry): Promise<void> {
    await this.ready;
    const line = JSON.stringify({ ...entry, timestamp: Date.now() }) + "\n";
    await appendFile(this.path, line);
  }
}
