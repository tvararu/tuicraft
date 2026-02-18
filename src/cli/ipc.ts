function parseResponseLines(buffer: string): string[] {
  const result: string[] = [];
  for (const line of buffer.split("\n")) {
    if (line === "") break;
    result.push(line);
  }
  return result;
}

export async function sendToSocket(
  command: string,
  path?: string,
): Promise<string[]> {
  const sock = path ?? (await import("lib/paths")).socketPath();
  let buffer = "";
  return new Promise<string[]>((resolve, reject) => {
    Bun.connect({
      unix: sock,
      socket: {
        open(socket) {
          socket.write(command + "\n");
          socket.flush();
        },
        data(socket, data) {
          buffer += Buffer.from(data).toString();
          if (buffer.endsWith("\n\n") || buffer === "\n") {
            socket.end();
            resolve(parseResponseLines(buffer));
          }
        },
        close() {
          resolve(parseResponseLines(buffer));
        },
        error(_socket, err) {
          reject(err);
        },
      },
    }).catch(reject);
  });
}

async function socketExists(path: string): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  return access(path)
    .then(() => true)
    .catch(() => false);
}

export async function ensureDaemon(): Promise<void> {
  const { socketPath } = await import("lib/paths");
  const path = socketPath();
  if (await socketExists(path)) {
    try {
      await sendToSocket("STATUS", path);
      return;
    } catch {
      const { unlink } = await import("node:fs/promises");
      await unlink(path).catch(() => {});
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
    try {
      while (true) {
        const { value, done } = await stderrReader.read();
        if (done) return;
        stderrChunks.push(Buffer.from(value).toString());
      }
    } catch {}
  })();
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
