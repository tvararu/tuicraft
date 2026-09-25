import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type LogEntry = {
  type: string;
  sender: string;
  message: string;
  channel?: string;
};

export class SessionLog {
  private readonly path: string;
  private readonly ready: Promise<void>;

  constructor(path: string) {
    this.path = path;
    this.ready = mkdir(dirname(path), { recursive: true }).then(
      () => undefined,
    );
  }

  async append(entry: LogEntry): Promise<void> {
    await this.ready;
    const line = `${JSON.stringify({ ...entry, timestamp: Date.now() })}\n`;
    await appendFile(this.path, line);
  }
}
