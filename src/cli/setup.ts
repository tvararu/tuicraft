import {
  createInterface,
  type Interface as ReadlineInterface,
} from "node:readline";
import { type Config, writeConfig } from "lib/config";

type CreateInterfaceFn = typeof createInterface;
type WriteFn = NodeJS.WritableStream["write"];

function rlOutput(rl: ReadlineInterface): NodeJS.WritableStream {
  return (rl as unknown as { output: NodeJS.WritableStream }).output;
}

function maskEcho(output: NodeJS.WritableStream, label: string): () => void {
  const orig = output.write;
  let prompted = false;
  output.write = ((s: string | Uint8Array, ...args: unknown[]) => {
    if (!prompted && s === label) prompted = true;
    else if (typeof s === "string" && /^[\x20-\x7e]+$/.test(s))
      return orig.call(output, "*".repeat(s.length));
    return (orig as Function).call(output, s, ...args);
  }) as WriteFn;
  return () => {
    output.write = orig;
  };
}

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
  const portStr = get("port");
  if (portStr !== undefined && Number.isNaN(parseInt(portStr, 10))) {
    throw new Error(`Invalid --port value: ${portStr}`);
  }
  return {
    account,
    password,
    character,
    host: get("host") ?? "t1",
    port: parseInt(portStr ?? "3724", 10),
    language: parseInt(get("language") ?? "1", 10),
    timeout_minutes: parseInt(get("timeout_minutes") ?? "30", 10),
  };
}

function ask(
  rl: ReadlineInterface,
  prompt: string,
  fallback?: string,
): Promise<string> {
  const label = fallback ? `${prompt} [${fallback}]: ` : `${prompt}: `;
  return new Promise((resolve) =>
    rl.question(label, (answer) => resolve(answer.trim() || fallback || "")),
  );
}

function askSecret(rl: ReadlineInterface, prompt: string): Promise<string> {
  const label = `${prompt}: `;
  const unmask = maskEcho(rlOutput(rl), label);
  return new Promise<string>((resolve) => {
    rl.question(label, (answer) => resolve(answer.trim()));
  }).finally(unmask);
}

export async function runSetupWizard(
  factory: CreateInterfaceFn = createInterface,
): Promise<Config> {
  const rl = factory({ input: process.stdin, output: process.stdout });
  try {
    const account = await ask(rl, "Account");
    const password = await askSecret(rl, "Password");
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

export async function runSetup(
  args: string[],
  factory?: CreateInterfaceFn,
): Promise<void> {
  const hasFlags = args.some((a) => a.startsWith("--"));
  const cfg = hasFlags ? parseSetupFlags(args) : await runSetupWizard(factory);
  await writeConfig(cfg);
  const { configPath } = await import("lib/paths");
  console.log(`Config saved to ${configPath()}`);
}
