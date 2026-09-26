import { type Paths, resolvePaths } from "#lib/paths";
export type Config = {
  account: string;
  password: string;
  character: string;
  host: string;
  port: number;
  language: number;
  timeout_minutes: number;
  spell_data_dir?: string;
  navigation_data_dir?: string;
  navigation_library?: string;
};

const DEFAULTS: Partial<Config> = {
  host: "t1",
  language: 1,
  port: 3724,
  timeout_minutes: 30,
};

function parseValue(raw: string): string | number {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}

function parseLines(text: string): Record<string, string | number> {
  const result: Record<string, string | number> = { ...DEFAULTS };
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    result[key] = parseValue(trimmed.slice(eq + 1).trim());
  }
  return result;
}

function validateConfig(result: Record<string, string | number>): void {
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
  for (const field of [
    "spell_data_dir",
    "navigation_data_dir",
    "navigation_library",
  ] as const) {
    const value = result[field];
    if (
      value !== undefined &&
      (typeof value !== "string" || value.trim().length === 0)
    )
      throw new Error(`Invalid ${field}: must be a non-empty string`);
  }
}

export function parseConfig(text: string): Config {
  const result = parseLines(text);
  validateConfig(result);
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

export async function readConfig(
  paths: Paths = resolvePaths(),
): Promise<Config> {
  const file = Bun.file(paths.configPath);
  if (!(await file.exists())) {
    throw new Error(
      "No config found. Run 'tuicraft setup' or 'tuicraft' interactively.",
    );
  }
  return parseConfig(await file.text());
}

export async function writeConfig(
  cfg: Config,
  paths: Paths = resolvePaths(),
): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(paths.configDir, { recursive: true });
  await writeFile(paths.configPath, `${serializeConfig(cfg)}\n`, {
    mode: 0o600,
  });
}

export function clientConfig(cfg: Config) {
  return {
    account: cfg.account.toUpperCase(),
    character: cfg.character,
    host: cfg.host,
    jevApiKey: Bun.env["TYPESAFE_API_KEY"],
    jevEndpointUrl:
      Bun.env["JEV_ENDPOINT_URL"] ?? Bun.env["TYPESAFE_ENDPOINT_URL"],
    jevFault: Bun.env["JEV_FAULT"],
    language: cfg.language,
    navigationDataDir: cfg.navigation_data_dir,
    navigationLibrary: cfg.navigation_library,
    password: cfg.password.toUpperCase(),
    port: cfg.port,
    spellDataDir: cfg.spell_data_dir,
  };
}
