import { parseArgs } from "node:util";
import { roleCapHours } from "factory/config";
import {
  createAccount,
  deleteAccount,
  expired,
  list,
  type Preset,
  presets,
  sweep,
} from "factory/soap";

const usage = `usage: soap create <${presets.join("|")}> [--owner <label>] [--gm <level>]
       soap delete <ACCOUNT>
       soap sweep [--hours N]
       soap list`;

const options = {
  gm: { type: "string" },
  hours: { type: "string" },
  owner: { type: "string" },
} as const;

type CreateArgs = { preset: string; owner?: string; gm?: string };

async function create({ preset, owner, gm }: CreateArgs): Promise<number> {
  if (!presets.includes(preset as Preset)) throw new Error(usage);
  const level = gm === undefined ? undefined : Number(gm);
  if (
    level !== undefined &&
    !(Number.isInteger(level) && level > 0 && level < 3)
  )
    throw new Error(`invalid --gm: ${gm} (1 or 2)`);
  const session = await createAccount({
    gm: level,
    owner,
    preset: preset as Preset,
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

async function show(): Promise<number> {
  console.log(JSON.stringify(await list(), null, 2));
  return 0;
}

function dispatch(args: string[]): Promise<number> {
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
  if (command === "list") return show();
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
