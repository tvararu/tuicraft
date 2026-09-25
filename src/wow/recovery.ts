import type { ControlPose } from "wow/control";
import { type EntityEvent, type EntityLookup, isUnit } from "wow/entity-store";
import { distance } from "wow/geometry";
import {
  type PlayerLife,
  type PlayerLifeState,
  readLife,
} from "wow/player-state";
import {
  buildReclaimCorpse,
  buildRepopRequest,
  buildResurrectResponse,
  buildSpiritHealerActivate,
  type CorpseQuery,
  type CorpseReclaimDelay,
  type DeathReleaseLocation,
  type ResurrectRequest,
} from "wow/protocol/death";
import { NpcFlag, ObjectType } from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import type { Vec3 } from "wow/protocol/packet";

export type RecoveryDeps = {
  send: (opcode: number, body?: Uint8Array) => void;
  now: () => number;
  selfGuid: () => bigint;
  getEntity: EntityLookup;
  pose: () => ControlPose | undefined;
};

export type RecoveryCorpse =
  | { status: "unknown" }
  | { status: "absent"; observedAt: number }
  | {
      status: "found";
      mapId: number;
      corpseMapId: number;
      position: Vec3;
      unknown: number;
      observedAt: number;
    };

export type RecoveryDelay = {
  delayMs: number;
  receivedAt: number;
  readyAt: number;
};
export type RecoveryQuery = {
  status: "unanswered" | "stale";
  epoch: number;
  requestedAt: number;
};

type RequestBase = { status: "unanswered"; epoch: number; requestedAt: number };
export type RecoveryRequest = RequestBase &
  (
    | { action: "query" }
    | { action: "release" }
    | { action: "reclaim"; timing: "known" | "unknown" }
    | { action: "spirit-healer"; guid: bigint }
    | {
        action: "resurrection";
        guid: bigint;
        accept: boolean;
        timing: "known" | "unknown";
      }
  );
export type ResurrectionResponse =
  | "unanswered"
  | "accept_requested"
  | "decline_requested";
export type RecoveryResurrection = ResurrectRequest & {
  receivedAt: number;
  readyAt: number | undefined;
  response: ResurrectionResponse;
};

export type RecoveryReclaim = {
  canRequest: boolean;
  readiness: "blocked" | "ready" | "unverified";
  reason: string | undefined;
  distance: number | undefined;
  remainingMs: number | undefined;
  pose: ControlPose | undefined;
};

export type RecoveryState = PlayerLifeState & {
  selfGuid: bigint;
  epoch: number;
  corpse: RecoveryCorpse;
  query: RecoveryQuery | undefined;
  reclaimDelay: RecoveryDelay | undefined;
  reclaim: RecoveryReclaim;
  graveyard: DeathReleaseLocation | undefined;
  resurrection: RecoveryResurrection | undefined;
  request: RecoveryRequest | undefined;
  disposed: boolean;
};

export type RecoveryEvent = {
  type:
    | "life_observed"
    | "recovery_invalidated"
    | "corpse_query_requested"
    | "corpse_observed"
    | "corpse_query_discarded"
    | "reclaim_delay_observed"
    | "graveyard_observed"
    | "resurrection_offered"
    | "release_requested"
    | "reclaim_requested"
    | "spirit_healer_requested"
    | "resurrection_response_requested";
  at: number;
  state: RecoveryState;
};

function copyCorpse(corpse: RecoveryCorpse): RecoveryCorpse {
  return corpse.status === "found"
    ? { ...corpse, position: { ...corpse.position } }
    : { ...corpse };
}

function copyGraveyard(
  value: DeathReleaseLocation | undefined,
): DeathReleaseLocation | undefined {
  if (!value) return undefined;
  return value.kind === "location"
    ? { ...value, position: { ...value.position } }
    : { ...value };
}

function dead(life: PlayerLife): boolean {
  return life === "dead" || life === "ghost";
}

export class RecoveryRuntime {
  private listener: ((event: RecoveryEvent) => void) | undefined;
  private disposed = false;
  private unavailable = false;
  private epoch = 0;
  private lastLife: PlayerLife;
  private corpse: RecoveryCorpse = { status: "unknown" };
  private queryPending: { epoch: number; requestedAt: number } | undefined;
  private delay: RecoveryDelay | undefined;
  private graveyard: DeathReleaseLocation | undefined;
  private request: RecoveryRequest | undefined;
  private spiritHealerPending:
    | {
        action: "spirit-healer";
        status: "unanswered";
        epoch: number;
        requestedAt: number;
        guid: bigint;
      }
    | undefined;
  private offer:
    | {
        packet: ResurrectRequest;
        receivedAt: number;
        response: ResurrectionResponse;
      }
    | undefined;

  constructor(private deps: RecoveryDeps) {
    this.lastLife = this.life().life;
  }

  onEvent(callback: ((event: RecoveryEvent) => void) | undefined): void {
    if (!this.disposed) this.listener = callback;
  }

  snapshot(): RecoveryState {
    const life = this.life();
    const request = this.request ?? this.spiritHealerPending;
    return {
      ...life,
      selfGuid: this.deps.selfGuid(),
      epoch: this.epoch,
      corpse: copyCorpse(this.corpse),
      query: this.queryPending
        ? {
            ...this.queryPending,
            status:
              this.queryPending.epoch === this.epoch ? "unanswered" : "stale",
          }
        : undefined,
      reclaimDelay: this.delay ? { ...this.delay } : undefined,
      reclaim: this.reclaimState(life.life),
      graveyard: copyGraveyard(this.graveyard),
      resurrection: this.resurrectionState(),
      request: request ? { ...request } : undefined,
      disposed: this.disposed,
    };
  }

  observeEntity(event: EntityEvent): void {
    if (this.disposed) return;
    if (event.type === "disappear") {
      if (event.guid !== this.deps.selfGuid()) return;
      this.unavailable = true;
      this.newEpoch();
      this.lastLife = "unknown";
      this.emit("recovery_invalidated");
      return;
    }
    if (event.entity.guid !== this.deps.selfGuid()) return;
    if (event.type === "appear") this.unavailable = false;
    this.observeLife();
  }

  queryCorpse(): RecoveryState {
    this.active();
    this.observeLife();
    if (this.queryPending)
      throw new Error("Previous corpse query remains unanswered");
    const requestedAt = this.deps.now();
    this.deps.send(GameOpcode.MSG_CORPSE_QUERY);
    this.queryPending = { epoch: this.epoch, requestedAt };
    if (!this.spiritHealerPending) {
      this.request = {
        action: "query",
        status: "unanswered",
        epoch: this.epoch,
        requestedAt,
      };
    }
    return this.emit("corpse_query_requested");
  }

  releaseSpirit(): RecoveryState {
    this.active();
    this.observeLife();
    if (this.life().life !== "dead")
      throw new Error("Release requires authoritative dead state");
    const requestedAt = this.deps.now();
    this.deps.send(GameOpcode.CMSG_REPOP_REQUEST, buildRepopRequest(0));
    this.request = {
      action: "release",
      status: "unanswered",
      epoch: this.epoch,
      requestedAt,
    };
    return this.emit("release_requested");
  }

  reclaimCorpse(): RecoveryState {
    this.active();
    this.observeLife();
    const gate = this.reclaimState(this.life().life);
    if (!gate.canRequest)
      throw new Error(`Cannot request reclaim: ${gate.reason}`);
    const requestedAt = this.deps.now();
    this.deps.send(GameOpcode.CMSG_RECLAIM_CORPSE, buildReclaimCorpse(0n));
    this.request = {
      action: "reclaim",
      status: "unanswered",
      epoch: this.epoch,
      requestedAt,
      timing: gate.remainingMs === undefined ? "unknown" : "known",
    };
    return this.emit("reclaim_requested");
  }

  activateSpiritHealer(guid: bigint): RecoveryState {
    this.active();
    this.observeLife();
    if (this.life().life !== "ghost")
      throw new Error("Spirit-healer activation requires observed ghost state");
    if (this.spiritHealerPending || this.request?.action === "spirit-healer")
      throw new Error("Previous spirit-healer request remains unanswered");
    if (guid === 0n) throw new Error("Spirit-healer GUID is unknown");
    const healer = this.deps.getEntity(guid);
    if (
      !isUnit(healer) ||
      healer.objectType !== ObjectType.UNIT ||
      (healer.npcFlags & NpcFlag.SPIRIT_HEALER) === 0
    )
      throw new Error("Observed creature is not a spirit healer");
    const requestedAt = this.deps.now();
    this.deps.send(
      GameOpcode.CMSG_SPIRIT_HEALER_ACTIVATE,
      buildSpiritHealerActivate(guid),
    );
    this.spiritHealerPending = {
      action: "spirit-healer",
      status: "unanswered",
      epoch: this.epoch,
      requestedAt,
      guid,
    };
    this.request = this.spiritHealerPending;
    return this.emit("spirit_healer_requested");
  }

  respondResurrection(accept: boolean): RecoveryState {
    this.active();
    this.observeLife();
    if (!dead(this.life().life))
      throw new Error(
        "Resurrection response requires observed dead or ghost state",
      );
    const offer = this.resurrectionState();
    if (!(offer && this.offer))
      throw new Error("No current resurrection offer");
    if (offer.response !== "unanswered")
      throw new Error("Resurrection offer already answered");
    if (
      accept &&
      offer.readyAt !== undefined &&
      this.deps.now() < offer.readyAt
    )
      throw new Error("Resurrection offer delay has not elapsed");
    const requestedAt = this.deps.now();
    this.deps.send(
      GameOpcode.CMSG_RESURRECT_RESPONSE,
      buildResurrectResponse(offer.guid, accept),
    );
    this.offer.response = accept ? "accept_requested" : "decline_requested";
    this.request = {
      action: "resurrection",
      status: "unanswered",
      epoch: this.epoch,
      requestedAt,
      guid: offer.guid,
      accept,
      timing: offer.readyAt === undefined ? "unknown" : "known",
    };
    return this.emit("resurrection_response_requested");
  }

  receiveCorpse(response: CorpseQuery): void {
    if (this.disposed) return;
    this.observeLife();
    const pending = this.queryPending;
    this.queryPending = undefined;
    if (!pending || pending.epoch !== this.epoch || this.unavailable) {
      this.emit("corpse_query_discarded");
      return;
    }
    const observedAt = this.deps.now();
    this.corpse = response.found
      ? {
          status: "found",
          mapId: response.mapId,
          corpseMapId: response.corpseMapId,
          position: { ...response.position },
          unknown: response.unknown,
          observedAt,
        }
      : { status: "absent", observedAt };
    if (this.request?.action === "query") {
      this.request = this.spiritHealerPending;
    }
    this.emit("corpse_observed");
  }

  receiveReclaimDelay({ delayMs }: CorpseReclaimDelay): void {
    if (this.disposed) return;
    this.observeLife();
    if (this.unavailable) return;
    const receivedAt = this.deps.now();
    this.delay = { delayMs, receivedAt, readyAt: receivedAt + delayMs };
    this.emit("reclaim_delay_observed");
  }

  receiveGraveyard(location: DeathReleaseLocation): void {
    if (this.disposed) return;
    this.observeLife();
    if (this.unavailable) return;
    this.graveyard = location;
    this.emit("graveyard_observed");
  }

  receiveResurrectRequest(packet: ResurrectRequest): void {
    if (this.disposed) return;
    this.observeLife();
    if (this.unavailable || this.life().life === "alive") return;
    this.offer = {
      packet,
      receivedAt: this.deps.now(),
      response: "unanswered",
    };
    this.emit("resurrection_offered");
  }

  dispose(): void {
    this.disposed = true;
    this.listener = undefined;
    this.unavailable = true;
    this.queryPending = undefined;
    this.newEpoch();
    this.lastLife = "unknown";
  }

  private active(): void {
    if (this.disposed) throw new Error("Recovery runtime disposed");
    if (!this.deps.selfGuid())
      throw new Error("Authenticated player GUID is unknown");
  }

  private life(): PlayerLifeState {
    if (this.unavailable || this.disposed)
      return { life: "unknown", health: undefined, flags: undefined };
    return readLife(this.deps.selfGuid(), this.deps.getEntity);
  }

  private observeLife(): void {
    const life = this.life().life;
    if (life === this.lastLife) return;
    if (
      (this.lastLife === "alive" && dead(life)) ||
      (dead(this.lastLife) && life === "alive")
    )
      this.newEpoch();
    if (this.request?.action === "release" && life === "ghost")
      this.request = undefined;
    if (life === "alive") {
      this.spiritHealerPending = undefined;
      if (this.request?.action === "spirit-healer") this.request = undefined;
    }
    this.lastLife = life;
    this.emit("life_observed");
  }
  private newEpoch(): void {
    this.epoch++;
    this.corpse = { status: "unknown" };
    this.delay = undefined;
    this.graveyard = undefined;
    this.offer = undefined;
    this.request = undefined;
    this.spiritHealerPending = undefined;
  }

  private resurrectionState(): RecoveryResurrection | undefined {
    if (!this.offer) return undefined;
    const { packet, receivedAt, response } = this.offer;
    const readyAt =
      packet.delayMs === undefined
        ? this.delay?.readyAt
        : receivedAt + packet.delayMs;
    return { ...packet, receivedAt, readyAt, response };
  }

  private reclaimState(life: PlayerLife): RecoveryReclaim {
    const pose = this.deps.pose();
    const remainingMs = this.delay
      ? Math.max(0, this.delay.readyAt - this.deps.now())
      : undefined;
    const result: RecoveryReclaim = {
      canRequest: false,
      readiness: "blocked",
      reason: undefined,
      distance: undefined,
      remainingMs,
      pose: pose ? { ...pose } : undefined,
    };
    result.reason = this.reclaimBlocker(life, pose);
    if (result.reason || this.corpse.status !== "found" || !pose) return result;
    const point = this.corpse.position;
    result.distance = distance(pose, point);
    if (result.distance > 39) result.reason = "corpse_out_of_range";
    else if (remainingMs !== undefined && remainingMs > 0)
      result.reason = "reclaim_delay";
    else {
      result.canRequest = true;
      result.readiness = remainingMs === undefined ? "unverified" : "ready";
    }
    return result;
  }

  private reclaimBlocker(
    life: PlayerLife,
    pose: ControlPose | undefined,
  ): string | undefined {
    if (life === "unknown") return "life_unknown";
    if (life !== "ghost") return "not_ghost";
    if (this.corpse.status === "unknown") return "corpse_unknown";
    if (this.corpse.status === "absent") return "corpse_absent";
    if (this.corpse.mapId !== this.corpse.corpseMapId || this.corpse.mapId < 0)
      return "corpse_position_unknown";
    if (
      !(
        pose &&
        Number.isFinite(pose.x) &&
        Number.isFinite(pose.y) &&
        Number.isFinite(pose.z)
      )
    )
      return "pose_unknown";
    if (pose.mapId !== this.corpse.corpseMapId) return "corpse_map_mismatch";
    const point = this.corpse.position;
    if (
      !(
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        Number.isFinite(point.z)
      )
    )
      return "corpse_position_unknown";
    return undefined;
  }

  private emit(type: RecoveryEvent["type"]): RecoveryState {
    const state = this.snapshot();
    this.listener?.({ type, at: this.deps.now(), state });
    return state;
  }
}
