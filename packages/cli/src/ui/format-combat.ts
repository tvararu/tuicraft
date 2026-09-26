import type { CombatState, CombatUnit, TacticsState } from "@tuicraft/core";
import { formatGuid } from "#ui/format";

type Observation = Readonly<Record<string, unknown>>;

const POWER_NAMES: Record<number, string> = {
  0: "mana",
  1: "rage",
  2: "focus",
  3: "energy",
  6: "runic power",
};

function show(value: unknown): string {
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : "unknown";
}

function record(value: unknown): Observation | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Observation)
    : undefined;
}

function vitals(unit: Observation): string {
  const power =
    typeof unit["powerType"] === "number"
      ? (POWER_NAMES[unit["powerType"]] ?? `power ${unit["powerType"]}`)
      : "power";
  return `health ${show(unit["health"])}/${show(unit["maxHealth"])}, ${power} ${show(unit["power"])}/${show(unit["maxPower"])}`;
}

function describeUnit(unit: Observation, guid: string): string {
  const name = typeof unit["name"] === "string" ? `${unit["name"]} ` : "";
  const level =
    typeof unit["level"] === "number" ? `, level ${unit["level"]}` : "";
  return `${name}${guid}${level}, health ${show(unit["health"])}/${show(unit["maxHealth"])}`;
}

function describeXp(xp: unknown): string {
  const award = record(xp);
  if (!award) return "none";
  const source =
    award["kind"] === "kill" ? `kill ${show(award["victim"])}` : "other";
  return `${show(award["total"])} (${source})`;
}

function describeAction(outcome: unknown): string {
  const action = record(outcome);
  if (!action) return "none";
  const spell =
    typeof action["spellId"] === "number" ? ` ${action["spellId"]}` : "";
  return `${show(action["kind"])}${spell} ${show(action["status"])}`;
}

export function observedKillXp(
  observation: Observation | undefined,
  target: bigint,
): number | undefined {
  const xp = record(observation?.["lastXp"]);
  if (xp?.["kind"] !== "kill" || xp["victim"] !== formatGuid(target))
    return undefined;
  return typeof xp["total"] === "number" ? xp["total"] : undefined;
}

export function formatFightOutcome(
  state: TacticsState,
  runId = state.runId,
): string {
  if (state.status !== "idle" || state.runId !== runId)
    return "stopped: replaced";
  const outcome = state.lastOutcome;
  if (!outcome) return `stopped: ${state.lastStopReason ?? "unknown"}`;
  const xp =
    state.targetGuid === undefined
      ? undefined
      : observedKillXp(outcome.observation, state.targetGuid);
  return `${outcome.status}: ${outcome.reason}${xp === undefined ? "" : `, XP ${xp}`}`;
}

export function formatTacticsState(state: TacticsState): string[] {
  const { lastOutcome: outcome, targetGuid } = state;
  const observation =
    outcome?.observation ?? state.lastRequest?.observation ?? {};
  const target = record(observation["target"]);
  const self = record(observation["self"]);
  const unavailable = observation["unavailable"];
  const lines = [`Tactics: ${state.status}`, `Run: ${state.runId ?? "none"}`];
  if (targetGuid !== undefined)
    lines.push(
      `Target: ${target ? describeUnit(target, formatGuid(targetGuid)) : formatGuid(targetGuid)}`,
    );
  lines.push(
    `Outcome: ${outcome ? `${outcome.status} (${outcome.reason})` : "none"}`,
  );
  if (state.lastStopReason) lines.push(`Stop reason: ${state.lastStopReason}`);
  if (self) lines.push(`Self: ${vitals(self)}`);
  lines.push(
    `Last XP: ${describeXp(observation["lastXp"])}`,
    `Last action: ${describeAction(observation["lastOutcome"])}`,
  );
  if (Array.isArray(unavailable))
    lines.push(`Unavailable actions: ${unavailable.length}`);
  if (state.lastDiscardReason)
    lines.push(`Last discard: ${state.lastDiscardReason}`);
  const { consecutive, limit, total } = state.timeouts;
  if (total > 0)
    lines.push(
      `Jev timeouts: ${consecutive} in a row of ${limit}, ${total} total`,
    );
  if (state.defense) lines.push(`Defense: ${state.defense}`);
  return lines;
}

function unitObservation(unit: CombatUnit): Observation {
  return { ...unit, guid: formatGuid(unit.guid) };
}

export function formatCombatState(state: CombatState): string[] {
  const self = unitObservation(state.self);
  const name = state.self.name ?? formatGuid(state.self.guid);
  let attacking = state.attacking ? "yes" : "no";
  if (state.attacking && state.attackTarget !== undefined)
    attacking = `yes ${formatGuid(state.attackTarget)}`;
  const lines = [
    `Self: ${name}, level ${show(state.self.level)}, ${vitals(self)}`,
    `Attacking: ${attacking}`,
    `Target: ${state.target ? describeUnit(unitObservation(state.target), formatGuid(state.target.guid)) : "none"}`,
  ];
  if (state.casting) lines.push(`Casting: spell ${state.casting.spellId}`);
  lines.push(
    `Auras: ${state.auras.length === 0 ? "none" : state.auras.map((aura) => aura.spellId).join(", ")}`,
    `Cooldowns: ${state.cooldowns.length === 0 ? "none" : state.cooldowns.map((cooldown) => `${cooldown.spellId} (${cooldown.remainingMs} ms)`).join(", ")}`,
    `Last XP: ${describeXp(state.lastXp ? { ...state.lastXp, victim: formatGuid(state.lastXp.victim) } : undefined)}`,
    `Last action: ${describeAction(state.lastOutcome)}`,
  );
  const unresolved = state.unknownLearned.length;
  const hint = unresolved > 0 ? " (run tuicraft spells to resolve)" : "";
  lines.push(
    `Spells: ${state.learned.length} learned, ${unresolved} unresolved${hint}`,
  );
  return lines;
}
