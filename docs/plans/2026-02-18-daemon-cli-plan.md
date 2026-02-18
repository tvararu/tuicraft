# Daemon CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace pipe mode with a daemon+CLI architecture and compile to a single binary.

**Architecture:** Same binary runs as interactive TUI (no args), background daemon (`--daemon`), or one-shot CLI client (args/subcommands). CLI talks to daemon over unix domain socket. Existing protocol/session layers untouched.

**Tech Stack:** Bun, TypeScript, `bun build --compile`, unix domain sockets via `Bun.listen`/`Bun.connect` unix option.

**Design doc:** `docs/plans/2026-02-18-daemon-cli-design.md`

**Style:** Follow `/typescript-style` skill. Never write comments. Colocated tests.

---

### Task 1: Single binary build

Get `bun build --compile` working with the existing codebase. This validates that path aliases (`baseUrl: ./src`) resolve correctly in the compiled binary and that the interactive TUI still works.

**Files:**

- Modify: `mise.toml` (add build task)
- No new source files

**Step 1: Add mise build task**

Add to `mise.toml`:

```toml
[tasks.build]
description = "Compile single binary"
run = "bun build --compile src/index.ts --outfile dist/tuicraft"
```

**Step 2: Run the build**

Run: `mise build`
Expected: Produces `./dist/tuicraft` binary, no errors.

**Step 3: Verify binary runs**

Run: `./dist/tuicraft --help` (will error since no --help yet, but should show the existing "Usage:" error from `src/index.ts`)
Expected: Prints usage message and exits, proving the binary works.

**Step 4: Commit**

```
Add mise build task for single binary

bun build --compile produces a standalone tuicraft binary with
no runtime dependencies. Path aliases resolve correctly.
```

---

### Task 2: XDG path helpers

Create a module that resolves config, runtime, and state directories following XDG conventions with practical fallbacks.

**Files:**

- Create: `src/paths.ts`
- Create: `src/paths.test.ts`

**Step 1: Write failing tests**

```typescript
import { test, expect, describe } from "bun:test";
import { configDir, runtimeDir, stateDir } from "paths";

describe("paths", () => {
  test("configDir defaults to ~/.config/tuicraft", () => {
    const dir = configDir();
    expect(dir).toMatch(/\/tuicraft$/);
    expect(dir).toContain("config");
  });

  test("runtimeDir includes uid", () => {
    const dir = runtimeDir();
    expect(dir).toMatch(/tuicraft-\d+$/);
  });

  test("stateDir defaults to ~/.local/state/tuicraft", () => {
    const dir = stateDir();
    expect(dir).toMatch(/\/tuicraft$/);
    expect(dir).toContain("state");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `mise test`
Expected: FAIL — module "paths" not found.

**Step 3: Implement paths module**

```typescript
import { tmpdir, homedir } from "node:os";

export function configDir(): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  const base = xdg || `${homedir()}/.config`;
  return `${base}/tuicraft`;
}

export function runtimeDir(): string {
  return `${tmpdir()}/tuicraft-${process.getuid!()}`;
}

export function stateDir(): string {
  const xdg = process.env["XDG_STATE_HOME"];
  const base = xdg || `${homedir()}/.local/state`;
  return `${base}/tuicraft`;
}

export function socketPath(): string {
  return `${runtimeDir()}/sock`;
}

export function pidPath(): string {
  return `${runtimeDir()}/pid`;
}

export function configPath(): string {
  return `${configDir()}/config.toml`;
}

export function logPath(): string {
  return `${stateDir()}/session.log`;
}
```

**Step 4: Run tests**

Run: `mise test`
Expected: All pass.

**Step 5: Commit**

```
Add XDG path helpers for config, runtime, and state dirs

Resolves file locations following XDG conventions with sensible
fallbacks. Runtime dir uses tmpdir + uid for cross-platform safety.
```

---

### Task 3: Config file reader and writer

Parse and serialize a flat TOML config. No dependency — the format is `key = "string"` or `key = number`, one per line.

**Files:**

- Create: `src/config.ts`
- Create: `src/config.test.ts`

**Step 1: Write failing tests**

```typescript
import { test, expect, describe } from "bun:test";
import { parseConfig, serializeConfig, type Config } from "config";

describe("parseConfig", () => {
  test("parses string and number values", () => {
    const input = `account = "x"\npassword = "xwow2026"\nport = 3724`;
    const cfg = parseConfig(input);
    expect(cfg.account).toBe("x");
    expect(cfg.password).toBe("xwow2026");
    expect(cfg.port).toBe(3724);
  });

  test("ignores blank lines and comments", () => {
    const input = `# comment\naccount = "x"\n\ncharacter = "Xia"`;
    const cfg = parseConfig(input);
    expect(cfg.account).toBe("x");
    expect(cfg.character).toBe("Xia");
  });

  test("uses defaults for missing keys", () => {
    const cfg = parseConfig(`account = "x"\npassword = "y"\ncharacter = "Z"`);
    expect(cfg.host).toBe("t1");
    expect(cfg.port).toBe(3724);
    expect(cfg.language).toBe(1);
    expect(cfg.timeout_minutes).toBe(30);
  });
});

describe("serializeConfig", () => {
  test("round-trips through parse", () => {
    const cfg: Config = {
      account: "x",
      password: "xwow2026",
      character: "Xia",
      host: "t1",
      port: 3724,
      language: 1,
      timeout_minutes: 30,
    };
    const text = serializeConfig(cfg);
    const parsed = parseConfig(text);
    expect(parsed).toEqual(cfg);
  });
});
```

**Step 2: Run tests to verify failure**

Run: `mise test`
Expected: FAIL — module "config" not found.

**Step 3: Implement config module**

```typescript
export type Config = {
  account: string;
  password: string;
  character: string;
  host: string;
  port: number;
  language: number;
  timeout_minutes: number;
};

const DEFAULTS: Partial<Config> = {
  host: "t1",
  port: 3724,
  language: 1,
  timeout_minutes: 30,
};

export function parseConfig(text: string): Config {
  const result: Record<string, string | number> = { ...DEFAULTS };
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    if (raw.startsWith('"') && raw.endsWith('"')) {
      result[key] = raw.slice(1, -1);
    } else {
      const n = Number(raw);
      result[key] = Number.isNaN(n) ? raw : n;
    }
  }
  return result as unknown as Config;
}

export function serializeConfig(cfg: Config): string {
  return Object.entries(cfg)
    .map(([k, v]) => (typeof v === "string" ? `${k} = "${v}"` : `${k} = ${v}`))
    .join("\n");
}

export async function readConfig(): Promise<Config> {
  const { configPath } = await import("paths");
  const file = Bun.file(configPath());
  if (!(await file.exists())) {
    throw new Error(
      "No config found. Run 'tuicraft setup' or 'tuicraft' interactively.",
    );
  }
  return parseConfig(await file.text());
}

export async function writeConfig(cfg: Config): Promise<void> {
  const { configPath, configDir } = await import("paths");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(configDir(), { recursive: true });
  await Bun.write(configPath(), serializeConfig(cfg) + "\n");
}
```

**Step 4: Run tests**

Run: `mise test`
Expected: All pass.

**Step 5: Commit**

```
Add config file parser and serializer

Flat TOML-like format with string and number values. Zero
dependencies. Reads from XDG config dir, writes with mkdir -p.
```

---

### Task 4: Setup command

`tuicraft setup` writes a config file. Interactive wizard when TTY, flag-based when not.

**Files:**

- Create: `src/setup.ts`
- Create: `src/setup.test.ts`

**Step 1: Write failing tests**

Test the flag-based path (easier to test than readline wizard):

```typescript
import { test, expect, describe } from "bun:test";
import { parseSetupFlags } from "setup";

describe("parseSetupFlags", () => {
  test("extracts all flags", () => {
    const args = [
      "--account",
      "x",
      "--password",
      "y",
      "--character",
      "Xia",
      "--host",
      "t1",
      "--port",
      "3724",
    ];
    const cfg = parseSetupFlags(args);
    expect(cfg.account).toBe("x");
    expect(cfg.password).toBe("y");
    expect(cfg.character).toBe("Xia");
    expect(cfg.host).toBe("t1");
    expect(cfg.port).toBe(3724);
  });

  test("uses defaults for missing optional flags", () => {
    const args = ["--account", "x", "--password", "y", "--character", "Xia"];
    const cfg = parseSetupFlags(args);
    expect(cfg.host).toBe("t1");
    expect(cfg.port).toBe(3724);
    expect(cfg.language).toBe(1);
    expect(cfg.timeout_minutes).toBe(30);
  });

  test("throws if required flags missing", () => {
    expect(() => parseSetupFlags(["--account", "x"])).toThrow();
  });
});
```

**Step 2: Run tests to verify failure**

Run: `mise test`
Expected: FAIL.

**Step 3: Implement setup module**

Implement `parseSetupFlags` for flag-based setup and `runSetupWizard` for interactive mode. The wizard uses `node:readline` (already a project dependency pattern from `tui.ts`).

```typescript
import { createInterface } from "node:readline";
import { type Config, writeConfig } from "config";

export function parseSetupFlags(args: string[]): Config {
  const get = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 ? args[idx + 1] : undefined;
  };
  const account = get("account");
  const password = get("password");
  const character = get("character");
  if (!account || !password || !character) {
    throw new Error("Required: --account, --password, --character");
  }
  return {
    account,
    password,
    character,
    host: get("host") ?? "t1",
    port: parseInt(get("port") ?? "3724", 10),
    language: parseInt(get("language") ?? "1", 10),
    timeout_minutes: parseInt(get("timeout_minutes") ?? "30", 10),
  };
}

function ask(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  fallback?: string,
): Promise<string> {
  const label = fallback ? `${prompt} [${fallback}]: ` : `${prompt}: `;
  return new Promise((resolve) =>
    rl.question(label, (answer) => resolve(answer.trim() || fallback || "")),
  );
}

export async function runSetupWizard(): Promise<Config> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const account = await ask(rl, "Account");
    const password = await ask(rl, "Password");
    const character = await ask(rl, "Character");
    const host = await ask(rl, "Host", "t1");
    const port = parseInt(await ask(rl, "Port", "3724"), 10);
    const language = parseInt(await ask(rl, "Language", "1"), 10);
    return {
      account,
      password,
      character,
      host,
      port,
      language,
      timeout_minutes: 30,
    };
  } finally {
    rl.close();
  }
}

export async function runSetup(args: string[]): Promise<void> {
  const hasFlags = args.some((a) => a.startsWith("--"));
  const cfg = hasFlags ? parseSetupFlags(args) : await runSetupWizard();
  await writeConfig(cfg);
  const { configPath } = await import("paths");
  console.log(`Config saved to ${configPath()}`);
}
```

**Step 4: Run tests**

Run: `mise test`
Expected: All pass.

**Step 5: Commit**

```
Add setup command with wizard and flag-based modes

Interactive wizard prompts for credentials when on a TTY.
Flag-based mode writes config directly for non-interactive use.
```

---

### Task 5: Event ring buffer

A fixed-size buffer that stores events and supports cursor-based draining.

**Files:**

- Create: `src/ring-buffer.ts`
- Create: `src/ring-buffer.test.ts`

**Step 1: Write failing tests**

```typescript
import { test, expect, describe } from "bun:test";
import { RingBuffer } from "ring-buffer";

describe("RingBuffer", () => {
  test("push and drain returns all items", () => {
    const buf = new RingBuffer<string>(10);
    buf.push("a");
    buf.push("b");
    expect(buf.drain()).toEqual(["a", "b"]);
  });

  test("drain is idempotent", () => {
    const buf = new RingBuffer<string>(10);
    buf.push("a");
    buf.drain();
    expect(buf.drain()).toEqual([]);
  });

  test("overflow drops oldest", () => {
    const buf = new RingBuffer<string>(3);
    buf.push("a");
    buf.push("b");
    buf.push("c");
    buf.push("d");
    expect(buf.drain()).toEqual(["b", "c", "d"]);
  });

  test("drain after overflow returns only unread", () => {
    const buf = new RingBuffer<string>(3);
    buf.push("a");
    buf.push("b");
    buf.drain();
    buf.push("c");
    buf.push("d");
    buf.push("e");
    buf.push("f");
    expect(buf.drain()).toEqual(["d", "e", "f"]);
  });
});
```

**Step 2: Run tests to verify failure**

Run: `mise test`
Expected: FAIL.

**Step 3: Implement ring buffer**

```typescript
export class RingBuffer<T> {
  private items: (T | undefined)[];
  private head = 0;
  private size = 0;
  private cursor = 0;
  private totalPushed = 0;

  constructor(private readonly capacity: number) {
    this.items = new Array(capacity);
  }

  push(item: T): void {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
    this.totalPushed++;
    if (this.cursor < this.totalPushed - this.size) {
      this.cursor = this.totalPushed - this.size;
    }
  }

  drain(): T[] {
    const available = this.totalPushed - this.cursor;
    if (available <= 0) return [];
    const result: T[] = [];
    const start = this.head - this.size + (this.size - available);
    for (let i = 0; i < available; i++) {
      const idx =
        (((start + i) % this.capacity) + this.capacity) % this.capacity;
      result.push(this.items[idx] as T);
    }
    this.cursor = this.totalPushed;
    return result;
  }
}
```

Note: the exact implementation may need adjustment to pass all tests — the implementer should get the tests green using whatever internal approach works.

**Step 4: Run tests**

Run: `mise test`
Expected: All pass.

**Step 5: Commit**

```
Add ring buffer for daemon event storage

Fixed-capacity buffer with cursor-based drain semantics.
Overflow drops oldest entries. Drain is idempotent.
```

---

### Task 6: Daemon process

The core daemon: connects to WoW, listens on a unix socket, buffers events, handles IPC commands.

**Files:**

- Create: `src/daemon.ts`
- Create: `src/daemon.test.ts`

**Step 1: Write failing tests**

Test the IPC command parser and response formatter (unit-testable without a real socket):

```typescript
import { test, expect, describe } from "bun:test";
import { parseIpcCommand, type IpcCommand } from "daemon";

describe("parseIpcCommand", () => {
  test("SAY", () => {
    expect(parseIpcCommand("SAY hello world")).toEqual({
      type: "say",
      message: "hello world",
    });
  });

  test("WHISPER", () => {
    expect(parseIpcCommand("WHISPER Xiara follow me")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "follow me",
    });
  });

  test("READ", () => {
    expect(parseIpcCommand("READ")).toEqual({ type: "read" });
  });

  test("READ_WAIT", () => {
    expect(parseIpcCommand("READ_WAIT 3000")).toEqual({
      type: "read_wait",
      ms: 3000,
    });
  });

  test("STOP", () => {
    expect(parseIpcCommand("STOP")).toEqual({ type: "stop" });
  });

  test("STATUS", () => {
    expect(parseIpcCommand("STATUS")).toEqual({ type: "status" });
  });

  test("WHO", () => {
    expect(parseIpcCommand("WHO mage")).toEqual({
      type: "who",
      filter: "mage",
    });
  });
});
```

**Step 2: Run tests to verify failure**

Run: `mise test`
Expected: FAIL.

**Step 3: Implement daemon module**

The daemon module exports:

- `parseIpcCommand` — parse a line from the socket into a command
- `startDaemon` — the main daemon entry point (connect to WoW, listen on socket)

For `startDaemon`, the full implementation wires together:

1. `readConfig()` to get credentials
2. `authHandshake()` + `worldSession()` from `client.ts`
3. `Bun.listen` with `unix` option for the socket
4. `RingBuffer` for event storage
5. Pidfile write/cleanup
6. Idle timeout via `setInterval`
7. SIGTERM/SIGINT handlers for cleanup

The IPC handler reads one line per connection, parses with `parseIpcCommand`, dispatches to the WorldHandle, writes response lines + empty terminator, closes connection. For READ_WAIT, it holds the connection open with a `setTimeout`.

Implement `parseIpcCommand` first to pass the unit tests, then implement `startDaemon` as a larger integration piece. `startDaemon` is difficult to unit test in isolation — it will be validated via live testing in Task 9.

**Step 4: Run tests**

Run: `mise test`
Expected: All pass.

**Step 5: Commit**

```
Add daemon with IPC command parsing and socket server

Connects to WoW, listens on unix socket, buffers events in a
ring buffer, handles commands from CLI clients.
```

---

### Task 7: IPC client and CLI router

The CLI side: parse args into subcommands, connect to daemon socket, send command, print response.

**Files:**

- Create: `src/cli.ts`
- Create: `src/cli.test.ts`
- Modify: `src/index.ts` (replace current entry point)

**Step 1: Write failing tests**

Test the arg parser that routes to the correct mode:

```typescript
import { test, expect, describe } from "bun:test";
import { parseArgs, type CliAction } from "cli";

describe("parseArgs", () => {
  test("no args with tty = interactive", () => {
    expect(parseArgs([], true)).toEqual({ mode: "interactive" });
  });

  test("no args without tty = interactive", () => {
    expect(parseArgs([], false)).toEqual({ mode: "interactive" });
  });

  test("setup subcommand", () => {
    expect(parseArgs(["setup", "--account", "x"], false)).toEqual({
      mode: "setup",
      args: ["--account", "x"],
    });
  });

  test("stop subcommand", () => {
    expect(parseArgs(["stop"], false)).toEqual({ mode: "stop" });
  });

  test("status subcommand", () => {
    expect(parseArgs(["status"], false)).toEqual({ mode: "status" });
  });

  test("read subcommand", () => {
    expect(parseArgs(["read"], false)).toEqual({
      mode: "read",
      wait: undefined,
      json: false,
    });
  });

  test("read with --wait", () => {
    expect(parseArgs(["read", "--wait", "5"], false)).toEqual({
      mode: "read",
      wait: 5,
      json: false,
    });
  });

  test("read with --json", () => {
    expect(parseArgs(["read", "--json"], false)).toEqual({
      mode: "read",
      wait: undefined,
      json: true,
    });
  });

  test("tail subcommand", () => {
    expect(parseArgs(["tail"], false)).toEqual({
      mode: "tail",
      json: false,
    });
  });

  test("logs subcommand", () => {
    expect(parseArgs(["logs"], false)).toEqual({ mode: "logs" });
  });

  test("help subcommand", () => {
    expect(parseArgs(["help"], false)).toEqual({ mode: "help" });
  });

  test("--help flag", () => {
    expect(parseArgs(["--help"], false)).toEqual({ mode: "help" });
  });

  test("bare string = say", () => {
    expect(parseArgs(["hello world"], false)).toEqual({
      mode: "say",
      message: "hello world",
      json: false,
    });
  });

  test("-w flag = whisper", () => {
    expect(parseArgs(["-w", "Xiara", "follow me"], false)).toEqual({
      mode: "whisper",
      target: "Xiara",
      message: "follow me",
      json: false,
    });
  });

  test("-y flag = yell", () => {
    expect(parseArgs(["-y", "HELLO"], false)).toEqual({
      mode: "yell",
      message: "HELLO",
      json: false,
    });
  });

  test("-g flag = guild", () => {
    expect(parseArgs(["-g", "guild msg"], false)).toEqual({
      mode: "guild",
      message: "guild msg",
      json: false,
    });
  });

  test("-p flag = party", () => {
    expect(parseArgs(["-p", "party msg"], false)).toEqual({
      mode: "party",
      message: "party msg",
      json: false,
    });
  });

  test("--who flag", () => {
    expect(parseArgs(["--who"], false)).toEqual({
      mode: "who",
      filter: undefined,
      json: false,
    });
  });

  test("--who with filter", () => {
    expect(parseArgs(["--who", "mage"], false)).toEqual({
      mode: "who",
      filter: "mage",
      json: false,
    });
  });

  test("--daemon flag", () => {
    expect(parseArgs(["--daemon"], false)).toEqual({ mode: "daemon" });
  });
});
```

**Step 2: Run tests to verify failure**

Run: `mise test`
Expected: FAIL.

**Step 3: Implement CLI module**

Implement `parseArgs` to route all CLI invocations. Implement `sendToSocket` that connects to the unix socket, writes a command line, reads response lines until the empty terminator, returns them. Implement `ensureDaemon` that checks for the socket file, spawns `tuicraft --daemon` if missing, polls until the socket appears.

**Step 4: Rewrite `src/index.ts`**

Replace the current entry point with a router that calls `parseArgs(Bun.argv.slice(2), process.stdin.isTTY ?? false)` and dispatches to the appropriate handler:

- `interactive` → existing `authHandshake` + `worldSession` + `startTui` flow (check for daemon first for reattach)
- `daemon` → `startDaemon()` from `daemon.ts`
- `setup` → `runSetup()` from `setup.ts`
- `help` → print help text
- `stop`, `status`, `read`, `tail`, `say`, `whisper`, etc. → `ensureDaemon()` then `sendToSocket()`
- `logs` → read log file

**Step 5: Run tests**

Run: `mise test`
Expected: All pass.

**Step 6: Commit**

```
Add CLI arg parser and socket client

Routes subcommands and flags to the correct handler. Socket
client connects to daemon, sends IPC commands, prints response.
```

---

### Task 8: Output formatting overhaul

Remove tab-delimited format. Human-readable is the single default. Add `--json` for JSONL output.

**Files:**

- Modify: `src/tui.ts` (remove non-interactive tab format, add JSON formatter)
- Modify: `src/tui.test.ts` (update tests)

**Step 1: Update tests**

Replace all `formatMessage(msg, false)` tab-delimited assertions with the human-readable format. The `interactive` boolean parameter is removed from `formatMessage` — it now always returns the bracketed format. Add a new `formatMessageJson` function.

Tests for `formatMessageJson`:

```typescript
test("json say", () => {
  const msg = { type: ChatType.SAY, sender: "Alice", message: "hi" };
  expect(JSON.parse(formatMessageJson(msg))).toEqual({
    type: "SAY",
    sender: "Alice",
    message: "hi",
  });
});

test("json whisper from", () => {
  const msg = { type: ChatType.WHISPER, sender: "Eve", message: "psst" };
  expect(JSON.parse(formatMessageJson(msg))).toEqual({
    type: "WHISPER_FROM",
    sender: "Eve",
    message: "psst",
  });
});
```

**Step 2: Run tests to verify failure**

Run: `mise test`
Expected: FAIL — signatures changed.

**Step 3: Implement changes**

- Remove the `interactive` parameter from `formatMessage`. It always returns bracketed format now.
- Remove the `interactive` parameter from `formatError` and `formatWhoResults`.
- Add `formatMessageJson(msg: ChatMessage): string` that returns a JSON string.
- Update `startTui` — the `interactive` parameter now only controls ANSI escape sequences and the readline prompt, not the message format itself.

**Step 4: Run tests**

Run: `mise test`
Expected: All pass.

**Step 5: Run typecheck**

Run: `mise typecheck`
Expected: No errors.

**Step 6: Commit**

```
Remove tab-delimited output, add JSON formatter

Human-readable bracketed format is now the only default. New
formatMessageJson function for --json JSONL output mode.
```

---

### Task 9: Session log writer

Daemon appends events to a persistent JSONL log file.

**Files:**

- Create: `src/session-log.ts`
- Create: `src/session-log.test.ts`

**Step 1: Write failing tests**

```typescript
import { test, expect, describe, afterEach } from "bun:test";
import { SessionLog } from "session-log";
import { unlink } from "node:fs/promises";

const TEST_LOG = "./tmp/test-session.log";

afterEach(async () => {
  try {
    await unlink(TEST_LOG);
  } catch {}
});

describe("SessionLog", () => {
  test("append writes JSONL line", async () => {
    const log = new SessionLog(TEST_LOG);
    await log.append({ type: "SAY", sender: "Alice", message: "hi" });
    const content = await Bun.file(TEST_LOG).text();
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe("SAY");
    expect(parsed.sender).toBe("Alice");
    expect(parsed.message).toBe("hi");
    expect(parsed.timestamp).toBeDefined();
  });

  test("multiple appends create multiple lines", async () => {
    const log = new SessionLog(TEST_LOG);
    await log.append({ type: "SAY", sender: "A", message: "1" });
    await log.append({ type: "SAY", sender: "B", message: "2" });
    const lines = (await Bun.file(TEST_LOG).text()).trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});
```

**Step 2: Run tests to verify failure**

Run: `mise test`
Expected: FAIL.

**Step 3: Implement session log**

```typescript
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
    this.ready = mkdir(dirname(path), { recursive: true });
  }

  async append(entry: LogEntry): Promise<void> {
    await this.ready;
    const line = JSON.stringify({ ...entry, timestamp: Date.now() }) + "\n";
    await appendFile(this.path, line);
  }
}
```

**Step 4: Run tests**

Run: `mise test`
Expected: All pass.

**Step 5: Commit**

```
Add session log writer for persistent event history

Appends JSONL entries with timestamps to the state directory.
Used by the daemon for full session history across restarts.
```

---

### Task 10: Help text

`tuicraft help` and `tuicraft --help` print a comprehensive usage reference.

**Files:**

- Create: `src/help.ts`
- Create: `src/help.test.ts`

**Step 1: Write failing test**

```typescript
import { test, expect } from "bun:test";
import { helpText } from "help";

test("help text includes all subcommands", () => {
  const text = helpText();
  expect(text).toContain("setup");
  expect(text).toContain("read");
  expect(text).toContain("tail");
  expect(text).toContain("logs");
  expect(text).toContain("stop");
  expect(text).toContain("status");
  expect(text).toContain("help");
  expect(text).toContain("--json");
  expect(text).toContain("--wait");
  expect(text).toContain("-w");
  expect(text).toContain("-y");
  expect(text).toContain("-g");
  expect(text).toContain("-p");
  expect(text).toContain("--who");
});
```

**Step 2: Run test to verify failure**

Run: `mise test`
Expected: FAIL.

**Step 3: Implement help text**

Write `helpText()` that returns the full usage string. This IS the API documentation for LLMs, so it should be clear, comprehensive, and show examples. Reference the design doc's CLI table.

**Step 4: Run tests**

Run: `mise test`
Expected: All pass.

**Step 5: Commit**

```
Add help text for CLI usage reference

Self-documenting --help serves as the API schema for LLM agents
discovering the tool at runtime.
```

---

### Task 11: Integration test and live validation

Wire everything together and validate against the real server.

**Files:**

- Modify: `src/test/live.ts` (add daemon mode tests)

**Step 1: Build the binary**

Run: `mise build`
Expected: Produces `./dist/tuicraft` binary.

**Step 2: Test setup command**

Run: `./dist/tuicraft setup --account x --password xwow2026 --character Xia --host t1`
Expected: `Config saved to ~/.config/tuicraft/config.toml`

**Step 3: Test one-shot say**

Run: `./dist/tuicraft "hello from binary"`
Expected: Daemon boots (may take a few seconds for auth), sends message, exits.

**Step 4: Test read**

Run: `./dist/tuicraft read`
Expected: Prints any buffered events (system messages from login).

**Step 5: Test read --wait**

Run: `./dist/tuicraft read --wait 5 --json`
Expected: Waits 5 seconds, prints any events as JSONL, exits.

**Step 6: Test status**

Run: `./dist/tuicraft status`
Expected: Shows daemon is running, connected.

**Step 7: Test stop**

Run: `./dist/tuicraft stop`
Expected: Daemon shuts down cleanly.

**Step 8: Test interactive reattach**

Run: `./dist/tuicraft "hello"` (boots daemon), then `./dist/tuicraft` (should reattach).
Expected: Interactive readline prompt, can send commands, see events.

**Step 9: Commit**

```
Validate daemon CLI end-to-end against live server

Tested setup, one-shot commands, read, read --wait, --json,
status, stop, and interactive reattach against AzerothCore.
```

---

### Task 12: Update docs

Replace pipe-mode.md with the new CLI reference. Update other docs.

**Files:**

- Modify: `docs/pipe-mode.md` (rewrite as CLI reference)
- Modify: `docs/plans/2026-02-17-tuicraft-design.md` (update TUI section)

**Step 1: Rewrite pipe-mode.md**

Replace the contents with a CLI reference based on the help text. Cover all subcommands, flags, output formats, daemon lifecycle, and file locations.

**Step 2: Update design doc**

Update the "TUI Interface" and "Pipe mode" sections in the main design doc to reference the daemon CLI model.

**Step 3: Commit**

```
Update docs for daemon CLI model

Replaces pipe mode reference with full CLI documentation
covering subcommands, flags, output formats, and daemon lifecycle.
```
