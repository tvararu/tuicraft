import type { RecoveryState } from "@tuicraft/core";
import { formatGuid } from "#ui/format";

const ANSWERS = {
  accept_requested: "accept requested",
  decline_requested: "decline requested",
} as const;

function acceptance(state: RecoveryState, now: number): string {
  const offer = state.resurrection;
  if (offer?.response !== "unanswered") return "no (answered)";
  if (state.life !== "dead" && state.life !== "ghost")
    return `no (life ${state.life})`;
  if (offer.readyAt !== undefined && now < offer.readyAt)
    return `no (wait ${offer.readyAt - now} ms)`;
  return "yes";
}

export function formatResurrectionOffer(
  state: RecoveryState,
  now: number,
): string[] {
  const offer = state.resurrection;
  if (!offer) return ["Resurrection offer: none"];
  const caster = offer.name
    ? `${offer.name} (${formatGuid(offer.guid)})`
    : `unknown caster ${formatGuid(offer.guid)}`;
  const answer =
    offer.response === "unanswered"
      ? "accept or decline with tuicraft resurrect accept|decline"
      : ANSWERS[offer.response];
  return [
    `Resurrection offer: ${caster}, ${answer}`,
    `Resurrection accept allowed: ${acceptance(state, now)}`,
  ];
}
