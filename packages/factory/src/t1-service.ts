import { factoryAccount } from "#factory/soap";

const trailingSlashes = /\/+$/;
const urlKey = "TUICRAFT_T1_SERVICE";

export const defaultServiceUrl = "http://100.73.138.96:7879";
export const factoryCharacter = /^F[a-p]{10}$/;
export const charEndpoints = [
  "position",
  "level",
  "money",
  "xp",
  "hearth",
  "rep",
  "items/add",
  "items/remove",
  "items/clear-bags",
  "spells/learn",
  "spells/unlearn",
  "quest/add",
  "quest/complete",
  "quest/remove",
  "quest/reward",
  "quest/objective",
  "life",
  "snapshot",
  "restore",
] as const;

export type CharEndpoint = (typeof charEndpoints)[number];
export type Json = Record<string, unknown>;
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type ServiceOptions = {
  baseUrl: string;
  fetch?: Fetch;
  timeoutMs?: number;
  truthTimeoutMs?: number;
};
type Reply = { ok?: unknown; reason?: unknown; error?: unknown };
export type T1Service = ReturnType<typeof createService>;

export class ServiceError extends Error {
  readonly reason: string;
  readonly status: number;
  readonly detail: string;

  constructor(reason: string, status: number, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = "ServiceError";
    this.reason = reason;
    this.status = status;
    this.detail = detail;
  }
}

export function serviceUrl(
  env: Record<string, string | undefined>,
  config: Record<string, string>,
): string {
  const url = env[urlKey] || config[urlKey] || defaultServiceUrl;
  return url.replace(trailingSlashes, "");
}

export function isCharEndpoint(name: string): name is CharEndpoint {
  return (charEndpoints as readonly string[]).includes(name);
}

function guard(ok: boolean, name: string): void {
  if (!ok)
    throw new ServiceError(
      "protected_account",
      0,
      `${name} is not a factory name`,
    );
}

function known(endpoint: string): void {
  if (!isCharEndpoint(endpoint))
    throw new ServiceError("unknown_endpoint", 0, endpoint);
}

export function jsonObject(text: string): Json | undefined {
  try {
    const json: unknown = JSON.parse(text);
    return json && typeof json === "object" && !Array.isArray(json)
      ? (json as Json)
      : undefined;
  } catch {
    return undefined;
  }
}

function parse(text: string, status: number): Json {
  const json = jsonObject(text);
  if (json) return json;
  throw new ServiceError("bad_response", status, text.slice(0, 200));
}

function failure(err: unknown, url: string): ServiceError {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError")
    return new ServiceError("timeout", 0, url);
  return new ServiceError("unreachable", 0, `${url}: ${err}`);
}

export function createService({
  baseUrl,
  fetch = globalThis.fetch,
  timeoutMs = 10_000,
  truthTimeoutMs = 60_000,
}: ServiceOptions) {
  async function request(
    method: "GET" | "POST",
    path: string,
    body?: Json,
    ms = timeoutMs,
  ): Promise<Json> {
    const url = `${baseUrl}${path}`;
    const init: RequestInit = {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      method,
      signal: AbortSignal.timeout(ms),
    };
    const res = await fetch(url, init).catch((err: unknown) => {
      throw failure(err, url);
    });
    const json = parse(await res.text(), res.status);
    const { ok, reason, error } = json as Reply;
    if (!res.ok || ok === false)
      throw new ServiceError(
        typeof reason === "string" ? reason : `http_${res.status}`,
        res.status,
        typeof error === "string" ? error : `${method} ${path}`,
      );
    return json;
  }

  const character = (name: string) => {
    guard(factoryCharacter.test(name), name);
    return name;
  };

  return {
    accounts: () => request("GET", "/accounts"),
    async char(name: string, endpoint: CharEndpoint, body: Json = {}) {
      known(endpoint);
      return await request(
        "POST",
        `/char/${character(name)}/${endpoint}`,
        body,
      );
    },
    health: () => request("GET", "/health"),
    presets: () => request("GET", "/presets"),
    async reset(account: string) {
      guard(factoryAccount.test(account), account);
      return await request("POST", `/account/${account}/reset`);
    },
    async truth(name: string) {
      return await request(
        "GET",
        `/truth/${character(name)}`,
        undefined,
        truthTimeoutMs,
      );
    },
  };
}
