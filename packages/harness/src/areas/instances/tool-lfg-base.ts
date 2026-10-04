import type { AreaEventOf, AreaState, PartyState } from "@peon/core";
import type { ToolCtx } from "#harness/contract/services";
import { Refusal } from "#harness/ops/refusal";
import { nextCall } from "#harness/tools/next-call";

export type LfgEvent = AreaEventOf<"lfg">;
export type LfgState = AreaState<"lfg">;

export type DungeonAfter = {
  do: string;
  detail: string;
  refreshed: boolean;
  saves: string[];
  status: string;
};

export type DungeonCtx = ToolCtx<DungeonAfter>;

export function emptyDungeon(): DungeonAfter {
  return {
    detail: "",
    do: "status",
    refreshed: false,
    saves: [],
    status: "DONE",
  };
}

export function refusalOf(reason: string, detail: string): Refusal {
  return new Refusal({
    detail,
    next: nextCall("dungeon", { do: "status" }),
    reason,
  });
}

export function refusedOutcome(reason: string, detail: string): never {
  throw refusalOf(reason, detail);
}

export const ROLE_TANK = 2;
export const ROLE_HEALER = 4;
export const ROLE_DAMAGE = 8;
export const RANDOM_DUNGEON_TYPE = 6;

export function roleBit(role: string): number {
  if (role === "tank") return ROLE_TANK;
  if (role === "healer") return ROLE_HEALER;
  if (role === "damage") return ROLE_DAMAGE;
  return 0;
}

export function hasRole(bits: number, role: string): boolean {
  const bit = roleBit(role);
  return bit !== 0 && bits % (bit * 2) >= bit;
}

export function rolesToBits(roles: readonly string[] | undefined): number {
  return (roles ?? ["damage"]).reduce(
    (bits, role) => bits + (hasRole(bits, role) ? 0 : roleBit(role)),
    0,
  );
}

export function roleNames(bits: number): string {
  const names = ["tank", "healer", "damage"].filter((role) =>
    hasRole(bits, role),
  );
  return names.length > 0 ? names.join(", ") : `roles ${bits}`;
}

export function entryType(entry: number): number {
  const unsigned = entry < 0 ? entry + 2 ** 32 : entry;
  return Math.floor(unsigned / 2 ** 24) % 256;
}

export function queueScope(party: PartyState): string {
  if (!party.inGroup) return "solo, not in a group (party of 1)";
  return `for your party of ${party.members.length + 1}`;
}

export function entryName(entry: number): string {
  if (entryType(entry) === RANDOM_DUNGEON_TYPE) return "a random dungeon";
  return `dungeon ${entry < 0 ? entry + 2 ** 32 : entry}`;
}
