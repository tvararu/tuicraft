import { Emitter } from "lib/emitter";
import { fakeTactics } from "test/encounter-cycle-fixtures";
import type { ControlPose } from "wow/control";
import type { PlayerLife } from "wow/player-state";
import type {
  RecoveryEvent,
  RecoveryReclaim,
  RecoveryState,
} from "wow/recovery";

export function dyingTactics(recovery: { die: () => void }, deaths = 1) {
  const tactics = fakeTactics([]);
  let remaining = deaths;
  return {
    ...tactics,
    start: async (
      ctx: { targetGuid: bigint; instruction: string },
      signal?: AbortSignal,
    ) => {
      await tactics.start(ctx, signal);
      if (remaining-- > 0) recovery.die();
    },
  };
}

type FakeCorpse =
  | { status: "unknown" }
  | { status: "absent" }
  | {
      status: "found";
      mapId: number;
      corpseMapId: number;
      position: { x: number; y: number; z: number };
    };

function positionedReclaim(
  corpse: Extract<FakeCorpse, { status: "found" }>,
  pose: ControlPose,
  remainingMs: number | undefined,
): RecoveryReclaim {
  if (pose.mapId !== corpse.corpseMapId)
    return blockedReclaim("corpse_map_mismatch", remainingMs, pose);
  const distance = Math.hypot(
    pose.x - corpse.position.x,
    pose.y - corpse.position.y,
    pose.z - corpse.position.z,
  );
  if (distance > 39)
    return blockedReclaim("corpse_out_of_range", remainingMs, pose, distance);
  if (remainingMs !== undefined && remainingMs > 0)
    return blockedReclaim("reclaim_delay", remainingMs, pose, distance);
  return {
    canRequest: true,
    distance,
    pose: { ...pose },
    readiness: remainingMs === undefined ? "unverified" : "ready",
    reason: undefined,
    remainingMs,
  };
}

function blockedReclaim(
  reason: RecoveryReclaim["reason"],
  remainingMs: number | undefined,
  pose: ControlPose | undefined,
  distance?: number,
): RecoveryReclaim {
  return {
    canRequest: false,
    distance,
    pose: pose ? { ...pose } : undefined,
    readiness: "blocked",
    reason,
    remainingMs,
  };
}

export function fakeRecovery(config: {
  offer?: boolean;
  life: PlayerLife[];
  corpse?: FakeCorpse;
  pose?: () => ControlPose | undefined;
  now?: () => number;
  reclaimDelaySchedule?: Array<{ atMs: number; delayMs: number }>;
}) {
  let lifeIndex = 0;
  let answered = false;
  let responded: "unanswered" | "accept_requested" | "decline_requested" =
    "unanswered";
  const corpse: FakeCorpse = config.corpse ?? { status: "unknown" };
  let delay:
    | { delayMs: number; receivedAt: number; readyAt: number }
    | undefined;
  const now = config.now ?? (() => 0);
  const posefn = config.pose ?? (() => undefined);
  const listeners = new Emitter<[RecoveryEvent]>();

  function life(): PlayerLife {
    return config.life[Math.min(lifeIndex, config.life.length - 1)] ?? "dead";
  }

  function reclaimGate(): RecoveryReclaim {
    const pose = posefn();
    const remainingMs = delay ? Math.max(0, delay.readyAt - now()) : undefined;
    if (life() !== "ghost")
      return blockedReclaim(
        life() === "unknown" ? "life_unknown" : "not_ghost",
        remainingMs,
        pose,
      );
    if (corpse.status !== "found")
      return blockedReclaim(
        corpse.status === "absent" ? "corpse_absent" : "corpse_unknown",
        remainingMs,
        pose,
      );
    if (!pose) return blockedReclaim("pose_unknown", remainingMs, pose);
    return positionedReclaim(corpse, pose, remainingMs);
  }

  function corpseSnapshot(): RecoveryState["corpse"] {
    if (corpse.status === "found")
      return {
        ...corpse,
        observedAt: now(),
        position: { ...corpse.position },
        unknown: 0,
      };
    if (corpse.status === "absent")
      return { observedAt: now(), status: "absent" };
    return { status: "unknown" };
  }

  function snapshot(): RecoveryState {
    return {
      corpse: corpseSnapshot(),
      disposed: false,
      epoch: 1,
      flags: undefined,
      graveyard: undefined,
      health: undefined,
      life: life(),
      query: undefined,
      reclaim: reclaimGate(),
      reclaimDelay: delay ? { ...delay } : undefined,
      request: undefined,
      resurrection: config.offer
        ? {
            delayMs: undefined,
            guid: 99n,
            name: "Healer",
            readyAt: undefined,
            receivedAt: 0,
            reserved: 0,
            response: responded,
            sickness: 0,
          }
        : undefined,
      selfGuid: 1n,
      spiritHealerCleared: undefined,
      spiritHealerConfirm: undefined,
    };
  }

  function emit(type: RecoveryEvent["type"]): void {
    listeners.emit({ at: now(), state: snapshot(), type });
  }

  for (const entry of config.reclaimDelaySchedule ?? []) {
    if (entry.atMs <= 0) {
      delay = {
        delayMs: entry.delayMs,
        readyAt: now() + entry.delayMs,
        receivedAt: now(),
      };
      continue;
    }
    setTimeout(() => {
      delay = {
        delayMs: entry.delayMs,
        readyAt: now() + entry.delayMs,
        receivedAt: now(),
      };
      emit("reclaim_delay_observed");
    }, entry.atMs);
  }

  return {
    answered: () => answered,
    die() {
      lifeIndex++;
      emit("life_observed");
    },
    onEvent(cb: (event: RecoveryEvent) => void) {
      return listeners.subscribe(cb);
    },
    queryCorpse() {
      emit("corpse_observed");
      return snapshot();
    },
    reclaimCorpse() {
      lifeIndex++;
      emit("life_observed");
      return snapshot();
    },
    releaseSpirit() {
      lifeIndex++;
      emit("life_observed");
      return snapshot();
    },
    respondResurrection(accept: boolean) {
      answered = true;
      responded = accept ? "accept_requested" : "decline_requested";
      if (accept) {
        lifeIndex++;
        emit("life_observed");
      }
      return snapshot();
    },
    snapshot,
  };
}
