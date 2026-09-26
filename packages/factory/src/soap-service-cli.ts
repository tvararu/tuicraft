import { characterName, factoryAccount } from "#factory/soap";
import {
  isCharEndpoint,
  type Json,
  jsonObject,
  ServiceError,
  type T1Service,
} from "#factory/t1-service";

export type ServiceDeps = {
  service: T1Service;
  out: (line: string) => void;
  err: (line: string) => void;
};

export const serviceCommands = [
  "health",
  "presets",
  "accounts",
  "truth",
  "setup",
  "reset",
] as const;

export const serviceUsage = `       soap health | soap presets | soap accounts
       soap truth <ACCOUNT>
       soap setup <ACCOUNT> <endpoint> [json]
       soap reset <ACCOUNT>`;

const usages = {
  reset: "usage: soap reset <ACCOUNT>",
  setup: "usage: soap setup <ACCOUNT> <endpoint> [json]",
  truth: "usage: soap truth <ACCOUNT>",
} as const;

class UsageError extends Error {}

function character(
  account: string | undefined,
  command: keyof typeof usages,
): string {
  if (!account) throw new UsageError(usages[command]);
  if (!factoryAccount.test(account))
    throw new ServiceError(
      "protected_account",
      0,
      `refusing non-factory account: ${account}`,
    );
  return characterName(account);
}

function body(text: string | undefined): Json {
  if (text === undefined) return {};
  const json = jsonObject(text);
  if (json) return json;
  throw new ServiceError("bad_json", 0, `expected a JSON object: ${text}`);
}

function call(
  { service }: ServiceDeps,
  [command, account, endpoint, json]: string[],
): Promise<Json> {
  if (command === "health") return service.health();
  if (command === "presets") return service.presets();
  if (command === "accounts") return service.accounts();
  if (command === "truth") return service.truth(character(account, command));
  if (command === "reset") {
    character(account, command);
    return service.reset(account as string);
  }
  if (command === "setup") {
    const name = character(account, command);
    if (!endpoint) throw new UsageError(usages.setup);
    if (!isCharEndpoint(endpoint))
      throw new ServiceError("unknown_endpoint", 0, endpoint);
    return service.char(name, endpoint, body(json));
  }
  throw new UsageError(serviceUsage);
}

export async function runService(
  args: string[],
  deps: ServiceDeps,
): Promise<number> {
  try {
    deps.out(JSON.stringify(await call(deps, args), null, 2));
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      deps.err(err.message);
      return 1;
    }
    if (!(err instanceof ServiceError)) throw err;
    const { reason, detail } = err;
    deps.out(JSON.stringify({ error: detail, ok: false, reason }));
    deps.err(err.message);
    return 1;
  }
}
