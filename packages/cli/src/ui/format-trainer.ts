import type {
  NamedTrainerSpell,
  NamedTrainerState,
  TrainerOutcome,
  TrainerRequest,
} from "@tuicraft/core";
import { formatGuid } from "#ui/format";

const TRAINER_TYPES: Record<number, string> = {
  0: "class",
  1: "mount",
  2: "tradeskill",
  3: "pet",
};

function describeSpell(spell: NamedTrainerSpell): string {
  const name = spell.name === null ? "" : ` ${spell.name}`;
  const rank = spell.rank === null ? "" : ` (${spell.rank})`;
  return `Spell ${spell.spellId}${name}${rank}: ${spell.state}, ${spell.cost} copper, level ${spell.requiredLevel}`;
}

function describeRequest(request: TrainerRequest): string {
  return request.action === "list"
    ? `list ${formatGuid(request.guid)}`
    : `train ${request.spellId} for ${request.cost} copper`;
}

function describeOutcome(outcome: TrainerOutcome): string {
  const reason = outcome.reason ? ` ${outcome.reason}` : "";
  const learned =
    outcome.learnedSpells.length > 0
      ? `, learned ${outcome.learnedSpells.join(" ")}`
      : "";
  const before =
    outcome.request.action === "train"
      ? outcome.request.coinageBefore
      : outcome.coinageAfter;
  const delta = outcome.moneyDelta ?? 0;
  const money = `${delta >= 0 ? "+" : ""}${delta} copper (coinage ${before ?? "unknown"} -> ${outcome.coinageAfter ?? "unknown"})`;
  return `Last: ${describeRequest(outcome.request)}: ${outcome.status}${reason}${learned}, ${money}`;
}

export function formatTrainerState(state: NamedTrainerState): string[] {
  const { offer, pending, lastOutcome } = state;
  const lines: string[] = [];
  if (offer) {
    const type =
      TRAINER_TYPES[offer.trainerType] ?? `type ${offer.trainerType}`;
    lines.push(
      `Trainer: ${formatGuid(offer.guid)} (${type}), ${offer.spells.length} spells, character level ${state.level ?? "unknown"}`,
    );
    lines.push(...offer.spells.map(describeSpell));
  } else lines.push("Trainer: none listed");
  if (pending) lines.push(`Request: ${describeRequest(pending)} unanswered`);
  if (lastOutcome) lines.push(describeOutcome(lastOutcome));
  lines.push(`Carried coinage: ${state.coinage ?? "unknown"}`);
  return lines;
}
