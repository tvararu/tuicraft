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
      result[key] = raw
        .slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    } else {
      const n = Number(raw);
      result[key] = Number.isNaN(n) ? raw : n;
    }
  }
  for (const field of ["account", "password", "character"] as const) {
    if (typeof result[field] !== "string") {
      throw new Error(`Missing required config field: ${field}`);
    }
  }
  for (const field of ["port", "language", "timeout_minutes"] as const) {
    const v = result[field];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      throw new Error(`Invalid ${field}: must be a finite positive number`);
    }
  }
  return result as unknown as Config;
}

export function serializeConfig(cfg: Config): string {
  return Object.entries(cfg)
    .map(([k, v]) =>
      typeof v === "string"
        ? `${k} = "${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
        : `${k} = ${v}`,
    )
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
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), serializeConfig(cfg) + "\n", { mode: 0o600 });
}
