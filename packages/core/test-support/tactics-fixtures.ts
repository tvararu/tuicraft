import type { JevActionResult } from "#wow/jev";
import {
  type TacticsContext,
  type TacticsDeps,
  type TacticsEvent,
  type TacticsFrame,
  TacticsLoop,
} from "#wow/tactics";

export const context: TacticsContext = {
  instruction: "Defeat the target and stay alive",
  targetGuid: 0xabcden,
};
export const frame: TacticsFrame = {
  candidates: [
    { description: "Cast the learned damage spell at the target", id: "smite" },
  ],
  observation: { self: { health: 100 }, sequence: 1, targetHealth: 60 },
};

export function judgment(choice = "smite"): JevActionResult {
  return {
    choice,
    confidence: 0.01,
    elapsedMs: 12,
    inputTokens: 18,
    model: "jev-1.13.0",
    probabilities: { smite: 0.51, wait: 0.49 },
  };
}

export function fixture(over: Partial<TacticsDeps> = {}) {
  const events: TacticsEvent[] = [];
  const actions: string[] = [];
  const stopped = Promise.withResolvers<void>();
  const requested = Promise.withResolvers<void>();
  let halts = 0;
  let defenses = 0;
  let activations = 0;
  let calls = 0;
  const tactics = new TacticsLoop({
    activate: () => {
      activations += 1;
    },
    apiKey: "ts_test_key",
    defend: () => {
      defenses += 1;
      return "auto_attack";
    },
    execute: (id) => {
      actions.push(id);
    },
    halt: () => {
      halts += 1;
    },
    observe: () => frame,
    prepare: async () => {},
    select: async () => {
      calls += 1;
      return judgment();
    },
    ...over,
  });
  tactics.onEvent((event) => {
    events.push(event);
    if (event.type === "stopped") stopped.resolve();
    if (event.type === "request") requested.resolve();
  });
  return {
    actions,
    get activations() {
      return activations;
    },
    get calls() {
      return calls;
    },
    get defenses() {
      return defenses;
    },
    events,
    get halts() {
      return halts;
    },
    requested: requested.promise,
    stopped: stopped.promise,
    tactics,
  };
}
