import { Emitter, type Unsubscribe } from "lib/emitter";
import { messageOf } from "lib/errors";
import type { TacticsContext, TacticsState } from "wow/tactics";

export type DefenseMode = "jev" | "auto_attack";

export type DefenseEngagement = {
  attacker: bigint;
  mode: DefenseMode;
  startedAt: number;
};

export type DefenseState = {
  armed: boolean;
  mode: DefenseMode | undefined;
  instruction: string;
  active: DefenseEngagement | undefined;
  engagements: number;
  yielded: bigint[];
  lastStop: { attacker: bigint; reason: string; at: number } | undefined;
  disarmReason: string | undefined;
};

export type DefenseEvent = {
  type: "armed" | "disarmed" | "started" | "stopped";
  at: number;
  attacker?: bigint;
  reason?: string;
  state: DefenseState;
};

export type DefenseDeps = {
  attackers: () => bigint[];
  attack: (guid: bigint) => void;
  face: (guid: bigint) => void;
  tactics: {
    start: (context: TacticsContext) => Promise<void>;
    stop: (reason: string) => void;
    snapshot: () => Pick<TacticsState, "lastOutcome" | "lastStopReason">;
  };
  owner: () => string | undefined;
  alive: () => boolean;
  jev: () => boolean;
  now: () => number;
};

const TICK_MS = 500;
const TAKEOVERS: Record<string, true> = {
  manual_override: true,
  replaced: true,
};

export class SelfDefense {
  private readonly deps: DefenseDeps;
  private readonly events = new Emitter<[DefenseEvent]>();
  private readonly yielded = new Set<bigint>();
  private armed = false;
  private mode: DefenseMode | undefined;
  private instruction = "";
  private active: DefenseEngagement | undefined;
  private engagements = 0;
  private lastStop: DefenseState["lastStop"];
  private disarmReason: string | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;

  constructor(deps: DefenseDeps) {
    this.deps = deps;
  }

  onEvent(listener: (event: DefenseEvent) => void): Unsubscribe {
    return this.events.subscribe(listener);
  }

  snapshot(): DefenseState {
    return {
      armed: this.armed,
      mode: this.mode,
      instruction: this.instruction,
      active: this.active ? { ...this.active } : undefined,
      engagements: this.engagements,
      yielded: [...this.yielded],
      lastStop: this.lastStop ? { ...this.lastStop } : undefined,
      disarmReason: this.disarmReason,
    };
  }

  arm(instruction: string): void {
    this.armed = true;
    this.mode = this.deps.jev() ? "jev" : "auto_attack";
    this.instruction = instruction;
    this.disarmReason = undefined;
    this.ticker ??= setInterval(() => this.tick(), TICK_MS);
    this.emit({ type: "armed" });
    this.tick();
  }

  disarm(reason: string): void {
    if (!this.armed) return;
    this.end(reason);
    this.armed = false;
    this.disarmReason = reason;
    clearInterval(this.ticker);
    this.ticker = undefined;
    this.yielded.clear();
    this.emit({ type: "disarmed", reason });
  }

  yieldTo(reason: string): void {
    const active = this.active;
    if (!active) return;
    this.yielded.add(active.attacker);
    this.end(reason);
  }

  tick(): void {
    if (!this.armed) return;
    const attackers = this.deps.attackers();
    for (const guid of this.yielded)
      if (!attackers.includes(guid)) this.yielded.delete(guid);
    if (this.active) {
      this.watch(attackers);
      return;
    }
    if (!this.deps.alive() || this.deps.owner()) return;
    const attacker = attackers.find((guid) => !this.yielded.has(guid));
    if (attacker !== undefined) this.engage(attacker);
  }

  dispose(): void {
    clearInterval(this.ticker);
    this.events.clear();
    this.armed = false;
    this.active = undefined;
  }

  private watch(attackers: bigint[]): void {
    const active = this.active;
    if (!active) return;
    if (!this.deps.alive()) {
      this.end("self_dead");
      return;
    }
    if (active.mode !== "auto_attack") return;
    if (!attackers.includes(active.attacker)) this.end("attacker_gone");
    else if (this.deps.owner()) this.yieldTo("replaced");
  }

  private engage(attacker: bigint): void {
    const mode = this.mode ?? "auto_attack";
    const engagement = { attacker, mode, startedAt: this.deps.now() };
    this.active = engagement;
    this.engagements++;
    this.emit({ type: "started", attacker });
    if (mode === "auto_attack") {
      this.meleeBack(attacker);
      return;
    }
    const context = { targetGuid: attacker, instruction: this.instruction };
    this.deps.tactics
      .start(context)
      .then(() => this.settle(engagement, undefined))
      .catch((error: unknown) => this.settle(engagement, error));
  }

  private meleeBack(attacker: bigint): void {
    try {
      this.deps.face(attacker);
      this.deps.attack(attacker);
    } catch (error) {
      this.end(messageOf(error, "attack_failed"));
    }
  }

  private settle(engagement: DefenseEngagement, error: unknown): void {
    if (this.active !== engagement) return;
    const tactics = this.deps.tactics.snapshot();
    const reason =
      error === undefined
        ? (tactics.lastOutcome?.reason ?? tactics.lastStopReason ?? "stopped")
        : messageOf(error, "fight_failed");
    if (error === undefined && TAKEOVERS[tactics.lastStopReason ?? ""])
      this.yielded.add(engagement.attacker);
    this.end(reason, false);
  }

  private end(reason: string, stopTactics = true): void {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    this.lastStop = { attacker: active.attacker, reason, at: this.deps.now() };
    if (active.mode === "jev" && stopTactics) this.deps.tactics.stop(reason);
    this.emit({ type: "stopped", attacker: active.attacker, reason });
  }

  private emit(event: Omit<DefenseEvent, "at" | "state">): void {
    this.events.emit({ ...event, at: this.deps.now(), state: this.snapshot() });
  }
}
