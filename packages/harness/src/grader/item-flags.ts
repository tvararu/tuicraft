import { writeFile } from "node:fs/promises";
import { type Exec, isRecord, parseJsonOutput } from "#harness/grader/exec";

export const ITEM_FLAGS_FILE = "item-flags.json";

export type ItemFlags = Record<string, number>;

const PROBE_TIMEOUT_MS = 120_000;
const MAX_BATCH = 40;
const PARTNER_FILES = [
  "partner",
  "partner1",
  "partner2",
  "partner3",
  "partner4",
] as const;

function vanishedOf(baseline: unknown, final: unknown): number[] {
  if (!(isRecord(baseline) && Array.isArray(baseline["inventory"]))) return [];
  const held: number[] = [];
  if (isRecord(final) && Array.isArray(final["inventory"]))
    for (const row of final["inventory"])
      if (isRecord(row) && typeof row["item"] === "number")
        held.push(row["item"]);
  const missing: number[] = [];
  for (const row of baseline["inventory"])
    if (
      isRecord(row) &&
      typeof row["item"] === "number" &&
      !held.includes(row["item"]) &&
      !missing.includes(row["item"])
    )
      missing.push(row["item"]);
  return missing;
}

async function truthOf(runDir: string, file: string): Promise<unknown> {
  const handle = Bun.file(`${runDir}/${file}`);
  if (!(await handle.exists())) return null;
  return (await handle.json()) as unknown;
}

function flagsIn(flow: unknown): ItemFlags {
  if (!(isRecord(flow) && isRecord(flow["result"]))) {
    const detail =
      isRecord(flow) && typeof flow["error"] === "string"
        ? flow["error"]
        : "no item-flags result";
    throw new Error(`item-flags: ${detail}`);
  }
  return flagsOf(flow["result"]);
}

function flagsOf(result: Record<string, unknown>): ItemFlags {
  if (!isRecord(result["flags"]))
    throw new Error("item-flags: the flow reported no flags.");
  const flags: ItemFlags = {};
  for (const [raw, value] of Object.entries(result["flags"])) {
    if (typeof value === "number" && Number.isFinite(value)) flags[raw] = value;
  }
  return flags;
}

async function query(
  exec: Exec,
  account: string,
  items: readonly number[],
  runDir: string,
): Promise<ItemFlags> {
  const arg = `items=${items.join(",")}`;
  const argv = [
    "bun",
    "packages/devtools/src/probe.ts",
    account,
    "--flow",
    "item-flags",
    "--arg",
    arg,
    "--out",
    `${runDir}/probe-item-flags`,
  ];
  const { code, stderr, stdout } = await exec(argv, {
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (code !== 0)
    throw new Error(`protocol:probe exited ${code}: ${stderr.trim()}`);
  const report = parseJsonOutput(stdout);
  if (!(isRecord(report) && Array.isArray(report["flows"])))
    throw new Error("protocol:probe gave no flows.");
  return flagsIn(report["flows"][0]);
}

export async function readItemFlags(runDir: string): Promise<ItemFlags> {
  const handle = Bun.file(`${runDir}/${ITEM_FLAGS_FILE}`);
  if (!(await handle.exists())) return {};
  const parsed = (await handle.json()) as unknown;
  if (!isRecord(parsed)) return {};
  return flagsOf({ flags: parsed });
}
async function vanishedIn(runDir: string): Promise<number[]> {
  const missing: number[] = [];
  const agent = await truthOf(runDir, "baseline.json");
  const rest = await truthOf(runDir, "final.json");
  for (const id of vanishedOf(agent, rest))
    if (!missing.includes(id)) missing.push(id);
  for (const who of PARTNER_FILES) {
    const baseline = await truthOf(runDir, `${who}-baseline.json`);
    if (baseline === null) continue;
    const final = await truthOf(runDir, `${who}-final.json`);
    for (const id of vanishedOf(baseline, final))
      if (!missing.includes(id)) missing.push(id);
  }
  return missing;
}

export async function recordItemFlags({
  account,
  exec,
  runDir,
}: {
  account: string;
  exec: Exec;
  runDir: string;
}): Promise<void> {
  const missing = await vanishedIn(runDir);
  if (missing.length === 0) return;
  const merged: ItemFlags = {};
  for (let at = 0; at < missing.length; at += MAX_BATCH) {
    const flags = await query(
      exec,
      account,
      missing.slice(at, at + MAX_BATCH),
      runDir,
    );
    for (const [raw, value] of Object.entries(flags)) merged[raw] = value;
  }
  const file = Bun.file(`${runDir}/${ITEM_FLAGS_FILE}`);
  if (await file.exists()) return;
  await writeFile(
    `${runDir}/${ITEM_FLAGS_FILE}`,
    `${JSON.stringify(merged)}\n`,
  );
}
