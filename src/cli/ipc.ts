import { ignoreFailure } from "lib/ignore-failure";
import { type Paths, resolvePaths } from "lib/paths";

function parseResponseLines(buffer: string): string[] {
  const result: string[] = [];
  for (const line of buffer.split("\n")) {
    if (line === "") break;
    result.push(line);
  }
  return result;
}

export function sendToSocket(
  command: string,
  sock?: string,
): Promise<string[]> {
  let buffer = "";
  let complete = false;
  return new Promise<string[]>((resolve, reject) => {
    Bun.connect({
      socket: {
        close() {
          if (!complete) reject(new Error("Incomplete daemon response"));
        },
        data(socket, data) {
          buffer += Buffer.from(data).toString();
          if (buffer.endsWith("\n\n") || buffer === "\n") {
            complete = true;
            socket.end();
            resolve(parseResponseLines(buffer));
          }
        },
        error(_socket, err) {
          reject(err);
        },
        open(socket) {
          socket.write(`${command}\n`);
          socket.flush();
        },
      },
      unix: sock ?? resolvePaths().socketPath,
    }).catch(reject);
  });
}

async function socketExists(path: string): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  return access(path)
    .then(() => true)
    .catch(() => false);
}

export async function ensureDaemon(
  paths: Paths = resolvePaths(),
): Promise<void> {
  const path = paths.socketPath;
  if (await socketExists(path)) {
    try {
      await sendToSocket("STATUS", path);
      return;
    } catch {
      const { unlink } = await import("node:fs/promises");
      await unlink(path).catch(ignoreFailure);
    }
  }

  const isSource = Bun.main.endsWith(".ts");
  const args = isSource
    ? [process.execPath, Bun.main, "--daemon"]
    : [process.execPath, "--daemon"];
  const proc = Bun.spawn(args, {
    stdio: ["ignore", "ignore", "pipe"],
  });
  proc.unref();
  const stderrChunks: string[] = [];
  const stderrReader = proc.stderr.getReader();
  const stderrDone = (async () => {
    while (true) {
      const { value, done } = await stderrReader.read();
      if (done) return;
      stderrChunks.push(Buffer.from(value).toString());
    }
  })().catch(ignoreFailure);
  void stderrDone;

  for (let i = 0; i < 300; i++) {
    await Bun.sleep(100);
    if (await socketExists(path)) return;
  }
  const stderr = stderrChunks.join("").trim();
  const message = stderr
    ? `Daemon failed to start within 30 seconds:\n${stderr}`
    : "Daemon failed to start within 30 seconds";
  throw new Error(message);
}
