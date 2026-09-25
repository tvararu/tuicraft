import { chmod, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { factoryConfigDir, factoryStateDir } from "factory/config";
import { type Config, parseConfig, serializeConfig } from "lib/config";

export type Preset = "fresh" | "eversong10" | "max80";
export type SoapResult = { ok: boolean; text: string };
export type Names = { account: string; character: string };
export type Ledger = Names & {
  password: string;
  preset: Preset;
  createdAt: string;
  owner: string;
};
export type CreateOptions = {
  preset: Preset;
  dir?: string;
  owner?: string;
  gm?: number;
};
export type Session = Names & {
  preset: Preset;
  password: string;
  dir: string;
  env: Record<"XDG_CONFIG_HOME" | "XDG_RUNTIME_DIR" | "XDG_STATE_HOME", string>;
};

export const presets: Preset[] = ["fresh", "eversong10", "max80"];
export const factoryAccount = /^FAC[0-9A-F]{10}$/;

const lockStaleMs = 30_000;
const lockPollMs = 100;
const lockTries = 400;
const pinfoTries = 20;
const pinfoPollMs = 250;
const navFields = [
  "spell_data_dir",
  "navigation_data_dir",
  "navigation_library",
] as const;
type Nav = Pick<Config, (typeof navFields)[number]>;
const envLine = /^([A-Z0-9_]+)=(.*)$/;
const quoted = /^(["'])(.*)\1$/;
const resultTag = /<result>([\s\S]*?)<\/result>/;
const faultTag = /<faultstring>([\s\S]*?)<\/faultstring>/;
const tripleLetter = /(.)\1\1/i;
const pinfoAccountLine = /Account:\s*([A-Za-z0-9_]+)/;
const accountMissing = /Account not exist/i;
const copyTargetMissing = /Account '.*' does not exist/i;
const lowerLetters = String.fromCharCode(
  ...Array.from({ length: 26 }, (_, i) => 97 + i),
);
const passwordAlphabet = `${lowerLetters.toUpperCase()}${lowerLetters}0123456789`;

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = line.trim().match(envLine);
    if (match?.[1]) env[match[1]] = (match[2] ?? "").replace(quoted, "$2");
  }
  return env;
}

async function soapEnv(): Promise<Record<string, string>> {
  return parseEnv(await Bun.file(`${factoryConfigDir()}/soap.env`).text());
}

function required(env: Record<string, string>, key: string): string {
  const value = env[key];
  if (!value)
    throw new Error(`${key} missing from ${factoryConfigDir()}/soap.env`);
  return value;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeXml(text: string): string {
  return text
    .replace(/&#xD;/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function envelope(command: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:AC"><SOAP-ENV:Body><ns1:executeCommand><command>${escapeXml(command)}</command></ns1:executeCommand></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}

export function parseResponse(xml: string): SoapResult {
  const result = xml.match(resultTag);
  if (result) return { ok: true, text: unescapeXml(result[1] ?? "").trim() };
  const fault = xml.match(faultTag);
  if (fault) return { ok: false, text: unescapeXml(fault[1] ?? "").trim() };
  return { ok: false, text: xml.trim() || "empty SOAP response" };
}

async function tryLock(dir: string): Promise<boolean> {
  try {
    await mkdir(dir);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

async function clearStaleLock(dir: string): Promise<void> {
  const info = await stat(dir).catch(() => undefined);
  if (info && Date.now() - info.mtimeMs > lockStaleMs)
    await rm(dir, { force: true, recursive: true });
}

async function acquireLock(dir: string): Promise<void> {
  await mkdir(factoryStateDir(), { recursive: true });
  for (let i = 0; i < lockTries; i++) {
    if (await tryLock(dir)) return;
    await clearStaleLock(dir);
    await Bun.sleep(lockPollMs);
  }
  throw new Error(`SOAP lock busy: ${dir}`);
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const dir = `${factoryStateDir()}/soap.lock`;
  await acquireLock(dir);
  try {
    return await fn();
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

async function post(command: string): Promise<SoapResult> {
  const env = await soapEnv();
  const user = required(env, "TUICRAFT_SOAP_USER");
  const auth = btoa(`${user}:${required(env, "TUICRAFT_SOAP_PASSWORD")}`);
  const headers = {
    Authorization: `Basic ${auth}`,
    "Content-Type": "text/xml",
  };
  const init = {
    body: envelope(command),
    headers,
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  };
  const res = await fetch(required(env, "TUICRAFT_SOAP_URL"), init);
  return parseResponse(await res.text());
}

function soap(command: string): Promise<SoapResult> {
  return withLock(() => post(command));
}

export function accountName(seconds: number, random: string): string {
  return `FAC${seconds.toString(16).padStart(8, "0")}${random}`.toUpperCase();
}

export function characterName(account: string): string {
  const digits = account.slice(3).toLowerCase();
  return `F${Array.from(digits, (d) => String.fromCharCode(97 + Number.parseInt(d, 16))).join("")}`;
}

export function hasTriple(name: string): boolean {
  return tripleLetter.test(name);
}

function randomByte(): string {
  const [byte = 0] = crypto.getRandomValues(new Uint8Array(1));
  return byte.toString(16).padStart(2, "0");
}

export function newNames(now = Date.now(), random = randomByte): Names {
  for (let seconds = Math.floor(now / 1000); ; seconds++) {
    for (let i = 0; i < 16; i++) {
      const account = accountName(seconds, random());
      const character = characterName(account);
      if (!hasTriple(character)) return { account, character };
    }
  }
}

export function newPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(
    bytes,
    (b) => passwordAlphabet[b % passwordAlphabet.length],
  ).join("");
}

export function assertFactory(account: string): void {
  if (!factoryAccount.test(account))
    throw new Error(`refusing non-factory account: ${account}`);
}

export function accountAgeHours(account: string, now = Date.now()): number {
  assertFactory(account);
  const seconds = Number.parseInt(account.slice(3, 11), 16);
  return (now / 1000 - seconds) / 3600;
}

export function pinfoAccount(text: string): string | undefined {
  return text.match(pinfoAccountLine)?.[1];
}

function ledgerDir(): string {
  return `${factoryStateDir()}/accounts`;
}

function ledgerPath(account: string): string {
  return `${ledgerDir()}/${account}.json`;
}

async function saveLedger(entry: Ledger): Promise<void> {
  await mkdir(ledgerDir(), { mode: 0o700, recursive: true });
  await writeFile(
    ledgerPath(entry.account),
    `${JSON.stringify(entry, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function loadLedger(account: string): Promise<Ledger | undefined> {
  const file = Bun.file(ledgerPath(account));
  return (await file.exists()) ? ((await file.json()) as Ledger) : undefined;
}

export async function list(): Promise<Ledger[]> {
  const names = await readdir(ledgerDir()).catch(() => [] as string[]);
  const accounts = names
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.slice(0, -5));
  const entries = await Promise.all(
    accounts.filter((a) => factoryAccount.test(a)).map(loadLedger),
  );
  return entries.filter((e): e is Ledger => e !== undefined);
}

async function must(command: string): Promise<string> {
  const res = await soap(command);
  if (!res.ok)
    throw new Error(`${command.split(" ").slice(0, 2).join(" ")}: ${res.text}`);
  return res.text;
}

async function templateFor(preset: Preset): Promise<string> {
  if (!presets.includes(preset))
    throw new Error(`unknown preset: ${preset} (${presets.join("|")})`);
  return required(await soapEnv(), `TUICRAFT_PRESET_${preset.toUpperCase()}`);
}

async function navConfig(): Promise<Nav> {
  const file = Bun.file(`${homedir()}/.config/tuicraft/config.toml`);
  const nav: Nav = {};
  if (!(await file.exists())) return nav;
  const base = parseConfig(await file.text());
  for (const key of navFields) if (base[key]) nav[key] = base[key];
  return nav;
}

async function writeSession(
  entry: Ledger,
  dir: string,
  nav: Nav,
): Promise<Session> {
  const env = {
    XDG_CONFIG_HOME: `${dir}/config`,
    XDG_RUNTIME_DIR: `${dir}/runtime`,
    XDG_STATE_HOME: `${dir}/state`,
  };
  const { account, password, character, preset } = entry;
  const config: Config = {
    account,
    character,
    host: "t1",
    language: 1,
    password,
    port: 3724,
    timeout_minutes: 30,
    ...nav,
  };
  await mkdir(`${env.XDG_CONFIG_HOME}/tuicraft`, {
    mode: 0o700,
    recursive: true,
  });
  await mkdir(env.XDG_RUNTIME_DIR, { mode: 0o700, recursive: true });
  await chmod(env.XDG_RUNTIME_DIR, 0o700);
  await mkdir(env.XDG_STATE_HOME, { recursive: true });
  await writeFile(
    `${env.XDG_CONFIG_HOME}/tuicraft/config.toml`,
    `${serializeConfig(config)}\n`,
    { mode: 0o600 },
  );
  return { account, character, dir, env, password, preset };
}

async function copyTemplate(template: string, names: Names): Promise<void> {
  const command = `pdump copy ${template} ${names.account} ${names.character}`;
  for (let i = 0; i < pinfoTries; i++) {
    const res = await soap(command);
    if (res.ok) return;
    if (!copyTargetMissing.test(res.text)) {
      throw new Error(`pdump copy: ${res.text}`);
    }
    await Bun.sleep(pinfoPollMs);
  }
  throw new Error(`pdump copy: ${names.account} never became visible`);
}

async function verifyCharacter({ account, character }: Names): Promise<void> {
  let last = "";
  for (let i = 0; i < pinfoTries; i++) {
    const res = await soap(`pinfo ${character}`);
    const owner = pinfoAccount(res.text);
    if (owner === account) return;
    if (owner)
      throw new Error(
        `pinfo ${character} names account ${owner}, expected ${account}`,
      );
    last = res.text;
    await Bun.sleep(pinfoPollMs);
  }
  throw new Error(`pinfo ${character} never showed ${account}: ${last}`);
}

export async function createAccount({
  preset,
  dir,
  gm,
  owner,
}: CreateOptions): Promise<Session> {
  const [template, nav] = await Promise.all([templateFor(preset), navConfig()]);
  const names = newNames();
  const entry: Ledger = {
    ...names,
    createdAt: new Date().toISOString(),
    owner: owner ?? process.cwd(),
    password: newPassword(),
    preset,
  };
  await must(`account create ${entry.account} ${entry.password}`);
  try {
    await saveLedger(entry);
    await copyTemplate(template, names);
    if (gm) await must(`account set gmlevel ${entry.account} ${gm} -1`);
    await verifyCharacter(names);
    return await writeSession(
      entry,
      dir ?? `${process.cwd()}/tmp/factory-account-${entry.account}`,
      nav,
    );
  } catch (err) {
    await deleteAccount(entry.account).catch((e) =>
      console.error(`cleanup of ${entry.account} failed: ${e}`),
    );
    throw err;
  }
}

async function isGone(account: string, character?: string): Promise<boolean> {
  const again = await soap(`account delete ${account}`);
  if (again.ok || !accountMissing.test(again.text)) return false;
  return (
    !character ||
    pinfoAccount((await soap(`pinfo ${character}`)).text) !== account
  );
}

async function verifyDeleted(
  account: string,
  character?: string,
): Promise<void> {
  for (let i = 0; i < pinfoTries; i++) {
    if (await isGone(account, character)) return;
    await Bun.sleep(pinfoPollMs);
  }
  throw new Error(`${account} still exists after account delete`);
}

export async function deleteAccount(account: string): Promise<void> {
  assertFactory(account);
  const entry = await loadLedger(account);
  const res = await soap(`account delete ${account}`);
  if (!(res.ok || accountMissing.test(res.text)))
    throw new Error(`account delete ${account}: ${res.text}`);
  await verifyDeleted(account, entry?.character);
  await rm(ledgerPath(account), { force: true });
}

export async function expired(
  hours: number,
  now = Date.now(),
): Promise<Ledger[]> {
  return (await list()).filter((e) => accountAgeHours(e.account, now) >= hours);
}

export async function sweep(hours: number): Promise<string[]> {
  const deleted: string[] = [];
  for (const { account } of await expired(hours)) {
    await deleteAccount(account).then(
      () => deleted.push(account),
      (err) =>
        console.error(
          `sweep ${account}: ${err instanceof Error ? err.message : err}`,
        ),
    );
  }
  return deleted;
}
