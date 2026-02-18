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
