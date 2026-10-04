import type { FlowContext, Json, ProbeFlow } from "#tools/probe-flows";

const MAX_ITEMS = 40;

function entriesOf(args: Readonly<Record<string, string>>): number[] {
  const raw = args["items"];
  if (raw === undefined || raw === "")
    throw new Error("item-flags needs items=<id,...>.");
  const parts = raw.split(",");
  if (parts.length > MAX_ITEMS)
    throw new Error(`item-flags takes at most ${MAX_ITEMS} ids.`);
  const ids: number[] = [];
  for (const part of parts) {
    const id = Number(part.trim());
    if (!Number.isInteger(id) || id <= 0)
      throw new Error(`item-flags needs items=<id,...>, not "${raw}".`);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
async function run({ args, handle }: FlowContext): Promise<Json> {
  const flags: Record<string, number | null> = {};
  for (const entry of entriesOf(args)) {
    const template = await handle.getItemTemplate(entry);
    flags[entry] = template === undefined ? null : template.flags;
  }
  return { flags };
}

export const flow: ProbeFlow = {
  name: "item-flags",
  run,
  usage:
    "--flow item-flags --arg items=<id,...>: query each template entry and report its flags, null when the server has no template.",
};
