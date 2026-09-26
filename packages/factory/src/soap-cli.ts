import { parseArgs } from "node:util";
import { factoryConfigDir, roleCapHours } from "#factory/config";
import {
  createAccount,
  deleteAccount,
  expired,
  type Ledger,
  list,
  parseEnv,
  sweep,
} from "#factory/soap";
import { isPreset, presets } from "#factory/soap-presets";
import {
  runService,
  type ServiceDeps,
  serviceCommands,
  serviceUsage,
} from "#factory/soap-service-cli";
import { createService, serviceUrl } from "#factory/t1-service";

const usage = `usage: soap create <${presets.join("|")}> [--owner <label>] [--gm <level>]
       soap delete <ACCOUNT>
       soap sweep [--hours N]
       soap list [--with-passwords]
${serviceUsage}`;

const options = {
  gm: { type: "string" },
  hours: { type: "string" },
  owner: { type: "string" },
  "with-passwords": { type: "boolean" },
} as const;

export type ListEntry = Omit<Ledger, "password"> & { password?: string };

type CreateArgs = { preset: string; owner?: string; gm?: string };

async function create({ preset, owner, gm }: CreateArgs): Promise<number> {
  if (!isPreset(preset)) throw new Error(usage);
  const level = gm === undefined ? undefined : Number(gm);
  if (
    level !== undefined &&
    !(Number.isInteger(level) && level > 0 && level < 3)
  )
    throw new Error(`invalid --gm: ${gm} (1 or 2)`);
  const session = await createAccount({
    gm: level,
    owner,
    preset,
  });
  console.log(JSON.stringify(session));
  return 0;
}

async function sweepOld(hoursArg?: string): Promise<number> {
  const hours =
    hoursArg === undefined
      ? Math.max(...Object.values(roleCapHours))
      : Number(hoursArg);
  if (!Number.isFinite(hours) || hours < 0)
    throw new Error(`invalid --hours: ${hoursArg}`);
  console.log(JSON.stringify({ deleted: await sweep(hours) }));
  return (await expired(hours)).length === 0 ? 0 : 1;
}

async function remove(account: string): Promise<number> {
  await deleteAccount(account);
  console.log(JSON.stringify({ deleted: [account] }));
  return 0;
}

export function listView(
  entries: Ledger[],
  withPasswords = false,
): ListEntry[] {
  return withPasswords
    ? entries
    : entries.map(({ password: _password, ...entry }) => entry);
}

async function show(withPasswords = false): Promise<number> {
  console.log(JSON.stringify(listView(await list(), withPasswords), null, 2));
  return 0;
}

async function serviceDeps(): Promise<ServiceDeps> {
  const file = Bun.file(`${factoryConfigDir()}/soap.env`);
  const config = (await file.exists()) ? parseEnv(await file.text()) : {};
  const baseUrl = serviceUrl(Bun.env, config);
  return {
    err: (line) => console.error(line),
    out: (line) => console.log(line),
    service: createService({ baseUrl }),
  };
}

function isServiceCommand(command: string | undefined): boolean {
  return serviceCommands.some((name) => name === command);
}

async function dispatch(args: string[]): Promise<number> {
  if (isServiceCommand(args[0])) return runService(args, await serviceDeps());
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    args,
    options,
  });
  const [command, target] = positionals;
  if (command === "create" && target)
    return create({ ...values, preset: target });
  if (command === "delete" && target) return remove(target);
  if (command === "sweep") return sweepOld(values.hours);
  if (command === "list") return show(values["with-passwords"]);
  throw new Error(usage);
}

export async function runSoap(args: string[]): Promise<number> {
  try {
    return await dispatch(args);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
