import { emptyParty, type PartyState } from "@peon/core";
import { queueScope } from "#harness/areas/instances/tool-lfg-base";
import {
  type InstancesSnapshot,
  type LfgSnapshot,
  liveSaves,
  saveLine,
} from "#harness/areas/instances/tool-status";

function queueName(lfg: LfgSnapshot): string {
  const entry = lfg.queue?.dungeon ?? lfg.selected[0];
  if (entry === undefined) return "a dungeon";
  const unsigned = entry < 0 ? entry + 2 ** 32 : entry;
  if (Math.floor(unsigned / 2 ** 24) % 256 === 6) return "a random dungeon";
  return `dungeon ${unsigned % 2 ** 24}`;
}

function queueLine(lfg: LfgSnapshot, party: PartyState): string {
  const waited = Math.max(0, lfg.queue?.queuedTime ?? 0);
  const wait = waited >= 60 ? `${Math.round(waited / 60)} min` : `${waited} s`;
  return `In queue: ${queueName(lfg)}, waiting ${wait} (${queueScope(party)}).`;
}

export function savesLine(
  instances: InstancesSnapshot,
  lfg: LfgSnapshot,
  now: number,
  party?: PartyState,
): string[] {
  const saves = liveSaves(instances, now);
  const queued = lfg.status === "queued" || lfg.status === "proposal";
  if (saves.length === 0 && !queued) return [];
  const out: string[] = [
    saves.length > 0
      ? `Saved: ${saves.map(saveLine).join("; ")}.`
      : "No saved instances.",
  ];
  if (queued) out.push(queueLine(lfg, party ?? emptyParty()));
  return out;
}
