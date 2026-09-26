import { Emitter, type Unsubscribe } from "lib/emitter";
import { type EntityLookup, fieldOf, isUnit } from "wow/entity-store";
import { readInventory } from "wow/inventory";
import { readLife, readSelfField } from "wow/player-state";
import { PLAYER_FIELDS, UNIT_FIELDS } from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import {
  buildTrainerBuySpell,
  buildTrainerList,
  type TrainerBuyFailure,
  type TrainerBuyResult,
  type TrainerList,
  type TrainerOfferedSpell,
  trainerFailureName,
} from "wow/protocol/trainer";

export type TrainerDeps = {
  send: (opcode: number, body?: Uint8Array) => void;
  now: () => number;
  selfGuid: () => bigint;
  getEntity: EntityLookup;
  learned: () => readonly number[];
};

export const TRAINER_ANSWER_MS = 5000;
const NPC_FLAG_TRAINER = 0x10;

export type TrainerSpellState =
  | "available"
  | "too_low"
  | "no_profession_slot"
  | "unavailable"
  | "known";
export type TrainerSpell = TrainerOfferedSpell & { state: TrainerSpellState };
export type TrainerOffer = Omit<TrainerList, "spells"> & {
  spells: TrainerSpell[];
  receivedAt: number;
};

export type TrainerRequest =
  | { action: "list"; guid: bigint; requestedAt: number }
  | {
      action: "train";
      guid: bigint;
      spellId: number;
      cost: number;
      coinageBefore: number | undefined;
      learnedBefore: number[];
      succeeded: boolean;
      requestedAt: number;
    };

export type TrainerOutcome = {
  action: TrainerRequest["action"];
  status: "confirmed" | "refused" | "unanswered";
  reason: string | undefined;
  request: TrainerRequest;
  learnedSpells: number[];
  coinageAfter: number | undefined;
  moneyDelta: number | undefined;
  observedAt: number;
};

export type TrainerState = {
  offer: TrainerOffer | undefined;
  pending: TrainerRequest | undefined;
  lastOutcome: TrainerOutcome | undefined;
  level: number | undefined;
  coinage: number | undefined;
};

export type TrainerEvent = {
  type:
    | "list_requested"
    | "listed"
    | "train_requested"
    | "trained"
    | "refused"
    | "unanswered";
  at: number;
  state: TrainerState;
};

type Learner = {
  level: number | undefined;
  professionPoints: number | undefined;
  learned: readonly number[];
};

function stateOf(
  spell: TrainerOfferedSpell,
  { level, professionPoints, learned }: Learner,
): TrainerSpellState {
  if (spell.usable === 2 || learned.includes(spell.spellId)) return "known";
  if (spell.usable === 0)
    return professionPoints !== undefined && professionPoints < spell.firstRank
      ? "no_profession_slot"
      : "available";
  return level !== undefined && level < spell.requiredLevel
    ? "too_low"
    : "unavailable";
}

export class TrainerRuntime {
  private readonly events = new Emitter<[TrainerEvent]>();
  private readonly deps: TrainerDeps;
  private disposed = false;
  private offer: (TrainerList & { receivedAt: number }) | undefined;
  private pending: TrainerRequest | undefined;
  private lastOutcome: TrainerOutcome | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: TrainerDeps) {
    this.deps = deps;
  }

  onEvent(listener: (event: TrainerEvent) => void): Unsubscribe {
    if (this.disposed) return () => undefined;
    return this.events.subscribe(listener);
  }

  snapshot(): TrainerState {
    const learner = this.learner();
    return {
      offer: this.offer && {
        ...this.offer,
        spells: this.offer.spells.map((spell) => ({
          ...spell,
          state: stateOf(spell, learner),
        })),
      },
      pending: this.pending ? { ...this.pending } : undefined,
      lastOutcome: this.lastOutcome ? { ...this.lastOutcome } : undefined,
      level: learner.level,
      coinage: this.coinage(),
    };
  }

  list(guid: bigint): TrainerState {
    this.ready();
    const trainer = this.deps.getEntity(guid);
    if (!(isUnit(trainer) && trainer.npcFlags & NPC_FLAG_TRAINER))
      throw new Error("Creature is not an observed trainer");
    this.deps.send(GameOpcode.CMSG_TRAINER_LIST, buildTrainerList(guid));
    return this.request({ action: "list", guid, requestedAt: this.deps.now() });
  }

  train(spellId: number): TrainerState {
    this.ready();
    const offer = this.offer;
    if (!offer) throw new Error("No listed trainer");
    const spell = offer.spells.find((s) => s.spellId === spellId);
    if (!spell) throw new Error("Spell is not offered by this trainer");
    const state = stateOf(spell, this.learner());
    if (state !== "available") throw new Error(`Spell is ${state}`);
    this.deps.send(
      GameOpcode.CMSG_TRAINER_BUY_SPELL,
      buildTrainerBuySpell(offer.guid, spellId),
    );
    return this.request({
      action: "train",
      guid: offer.guid,
      spellId,
      cost: spell.cost,
      coinageBefore: this.coinage(),
      learnedBefore: [...this.deps.learned()],
      succeeded: false,
      requestedAt: this.deps.now(),
    });
  }

  receiveList(list: TrainerList): void {
    if (this.disposed) return;
    this.offer = { ...list, receivedAt: this.deps.now() };
    if (this.pending?.action === "list" && this.pending.guid === list.guid)
      this.settle("confirmed", undefined);
    else this.emit("listed");
  }

  receiveSucceeded({ guid, spellId }: TrainerBuyResult): void {
    const pending = this.pending;
    if (this.disposed || pending?.action !== "train") return;
    if (pending.guid !== guid || pending.spellId !== spellId) return;
    pending.succeeded = true;
    this.observe();
  }

  receiveFailed({ guid, spellId, reason }: TrainerBuyFailure): void {
    const pending = this.pending;
    if (this.disposed || pending?.action !== "train") return;
    if (pending.guid === guid && pending.spellId === spellId)
      this.settle("refused", trainerFailureName(reason));
  }

  observe(): void {
    const pending = this.pending;
    if (this.disposed || pending?.action !== "train" || !pending.succeeded)
      return;
    const coinage = this.coinage();
    const paid =
      pending.cost === 0 ||
      (coinage !== undefined &&
        pending.coinageBefore !== undefined &&
        pending.coinageBefore - coinage >= pending.cost);
    if (paid && this.newlyLearned(pending).length > 0)
      this.settle("confirmed", undefined);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.events.clear();
    this.offer = undefined;
    this.pending = undefined;
    this.lastOutcome = undefined;
  }

  private newlyLearned(request: TrainerRequest): number[] {
    if (request.action !== "train") return [];
    return this.deps
      .learned()
      .filter((id) => !request.learnedBefore.includes(id));
  }

  private request(request: TrainerRequest): TrainerState {
    this.pending = request;
    this.timer = setTimeout(
      () => this.settle("unanswered", "server_unanswered"),
      TRAINER_ANSWER_MS,
    );
    return this.emit(`${request.action}_requested`);
  }

  private settle(status: TrainerOutcome["status"], reason?: string): void {
    const request = this.pending;
    if (!request) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    const coinageAfter = this.coinage();
    const before =
      request.action === "train" ? request.coinageBefore : coinageAfter;
    this.lastOutcome = {
      action: request.action,
      status,
      reason,
      request,
      learnedSpells: this.newlyLearned(request),
      coinageAfter,
      moneyDelta:
        coinageAfter === undefined || before === undefined
          ? undefined
          : coinageAfter - before,
      observedAt: this.deps.now(),
    };
    this.pending = undefined;
    if (status === "confirmed")
      this.emit(request.action === "list" ? "listed" : "trained");
    else this.emit(status);
  }

  private ready(): void {
    if (this.disposed) throw new Error("Trainer runtime disposed");
    const self = this.deps.selfGuid();
    if (!self) throw new Error("Authenticated player GUID is unknown");
    if (readLife(self, this.deps.getEntity).life !== "alive")
      throw new Error("Training requires authoritative alive state");
    if (this.pending)
      throw new Error("Previous trainer request remains unanswered");
  }

  private learner(): Learner {
    const self = this.deps.selfGuid();
    return {
      level: this.level(),
      professionPoints: readSelfField(
        self,
        this.deps.getEntity(self),
        PLAYER_FIELDS.CHARACTER_POINTS2.offset,
      ),
      learned: this.deps.learned(),
    };
  }

  private level(): number | undefined {
    return fieldOf(
      this.deps.getEntity(this.deps.selfGuid()),
      UNIT_FIELDS.LEVEL.offset,
    );
  }

  private coinage(): number | undefined {
    return readInventory(this.deps.selfGuid(), this.deps.getEntity).coinage;
  }

  private emit(type: TrainerEvent["type"]): TrainerState {
    const state = this.snapshot();
    this.events.emit({ type, at: this.deps.now(), state });
    return state;
  }
}
