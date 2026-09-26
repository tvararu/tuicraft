import type { WorldHandle } from "#wow/client";
import type { Runtimes } from "#wow/runtime";
import type { TrainerOffer, TrainerSpell, TrainerState } from "#wow/trainer";
import type { WorldConn } from "#wow/world-conn";

export type NamedTrainerSpell = TrainerSpell & {
  name: string | null;
  rank: string | null;
};
export type NamedTrainerState = Omit<TrainerState, "offer"> & {
  offer:
    | (Omit<TrainerOffer, "spells"> & { spells: NamedTrainerSpell[] })
    | undefined;
};

export function trainerMethods(conn: WorldConn, rt: Runtimes) {
  const { trainer, combat } = rt;
  return {
    async getTrainerState(): Promise<NamedTrainerState> {
      await rt.prepareCatalog().catch(() => undefined);
      const state = trainer.snapshot();
      const { offer } = state;
      if (!offer) return { ...state, offer };
      const spells = offer.spells.map((spell) => {
        const definition = combat.definition(spell.spellId);
        return {
          ...spell,
          name: definition?.name ?? null,
          rank: definition?.rank || null,
        };
      });
      return { ...state, offer: { ...offer, spells } };
    },
    openTrainer(guid) {
      rt.override();
      trainer.list(guid);
    },
    trainSpell(spellId) {
      rt.override();
      trainer.train(spellId);
    },
    onTrainerEvent(cb) {
      return conn.events.trainer.subscribe(cb);
    },
  } satisfies Partial<WorldHandle>;
}
