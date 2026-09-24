import { pause } from "lib/abort";
import { messageOf } from "lib/errors";
import type { ControlPose } from "wow/control";
import { cycleStop as stop, type CycleStop } from "wow/cycle-stop";
import type { CycleDeps } from "wow/encounter-cycle";
import type { EventWaiter } from "wow/event-waiter";
import { bearing, distance, normalizeAngle } from "wow/geometry";
import type { PlayerLife } from "wow/player-state";
import type {
  RecoveryEvent,
  RecoveryReclaim,
  RecoveryState,
} from "wow/recovery";

const RECLAIM_MARGIN_MS = 2000;
const LEG_LEASE_MS = 3000;
const DETOUR_RAD = Math.PI / 4;
const RECOVERY_WAIT_MS = 30000;
const POSE_MOVED_EPS = 0.05;

export type CorpseRun = Pick<CycleDeps, "recovery" | "control"> & {
  events: EventWaiter<RecoveryEvent>;
  signal: AbortSignal;
};

type Done = { ok: true } | CycleStop;
type Observed = { ok: true; state: RecoveryState } | CycleStop;
type Leg =
  | {
      ok: true;
      arrived: boolean;
      moved: boolean;
      pose: ControlPose | undefined;
      reclaim: RecoveryReclaim;
    }
  | CycleStop;

const DONE = { ok: true } as const;

export async function recoverCorpse(run: CorpseRun): Promise<Done> {
  if (run.recovery.snapshot().resurrection?.response === "unanswered") {
    run.recovery.respondResurrection(true);
    return confirmLife(run, "alive", "resurrection_not_confirmed");
  }
  const ghost = await becomeGhost(run);
  if (!ghost.ok) return ghost;
  const corpse = await findCorpse(run);
  if (!corpse.ok) return corpse;
  const ready = await awaitReclaim(run, corpse.state);
  if (!ready.ok) return ready;
  if (!ready.state.reclaim.canRequest) {
    const reached = await reachCorpse(run, ready.state);
    if (!reached.ok) return reached;
  }
  run.recovery.reclaimCorpse();
  return confirmLife(run, "alive", "reclaim_not_confirmed");
}

async function becomeGhost(run: CorpseRun): Promise<Done> {
  const life = run.recovery.snapshot().life;
  if (life === "ghost") return DONE;
  if (life !== "dead") return stop("life_unknown");
  run.recovery.releaseSpirit();
  return confirmLife(run, "ghost", "ghost_not_confirmed");
}

async function confirmLife(
  run: CorpseRun,
  life: PlayerLife,
  cause: string,
): Promise<Done> {
  const observed = await run.events.find(
    (event) => event.type === "life_observed" && event.state.life === life,
    RECOVERY_WAIT_MS,
    run.signal,
  );
  return observed ? DONE : stop(cause);
}

async function findCorpse(run: CorpseRun): Promise<Observed> {
  run.recovery.queryCorpse();
  const queried = await run.events.find(
    (event) => event.type === "corpse_observed",
    RECOVERY_WAIT_MS,
    run.signal,
  );
  if (!queried) return stop("corpse_query_timeout");
  if (queried.state.corpse.status !== "found") return stop("corpse_absent");
  return { ok: true, state: queried.state };
}

async function awaitReclaim(
  run: CorpseRun,
  observed: RecoveryState,
): Promise<Observed> {
  let state = observed;
  for (let attempt = 0; attempt < 2 && remaining(state) > 0; attempt++) {
    await pause(remaining(state) + RECLAIM_MARGIN_MS, run.signal);
    state = run.recovery.snapshot();
  }
  if (remaining(state) > 0) return stop("reclaim_delayed");
  if (state.reclaim.reason === "corpse_map_mismatch")
    return stop("corpse_out_of_range", poseRange(state.reclaim));
  return { ok: true, state };
}

async function reachCorpse(
  run: CorpseRun,
  state: RecoveryState,
): Promise<Done> {
  if (state.corpse.status !== "found") return stop("corpse_absent");
  const corpse = state.corpse.position;
  const before = run.control.snapshot().pose;
  if (!before) return stop("corpse_unreachable", poseRange(state.reclaim));
  let leg = await travelLeg(run, 0, corpse, before);
  if (!leg.ok) return leg;
  const retried = !leg.arrived && !leg.moved;
  if (retried) {
    leg = await travelLeg(run, DETOUR_RAD, corpse, leg.pose ?? before);
    if (!leg.ok) return leg;
  }
  if (leg.arrived) return DONE;
  const cause = retried ? "corpse_unreachable" : "corpse_out_of_range";
  return stop(cause, poseRange(leg.reclaim));
}

async function travelLeg(
  run: CorpseRun,
  offset: number,
  corpse: { x: number; y: number; z: number },
  before: ControlPose,
): Promise<Leg> {
  try {
    run.control.face(normalizeAngle(bearing(before, corpse) + offset));
    run.control.move("forward", LEG_LEASE_MS);
  } catch (error) {
    return stop("corpse_unreachable", {
      pose: before,
      error: messageOf(error),
    });
  }
  await pause(LEG_LEASE_MS, run.signal);
  const after = run.control.snapshot().pose;
  const reclaim = run.recovery.snapshot().reclaim;
  return {
    ok: true,
    arrived: reclaim.canRequest,
    moved: after !== undefined && distance(before, after) > POSE_MOVED_EPS,
    pose: after,
    reclaim,
  };
}

function remaining(state: RecoveryState): number {
  return state.reclaim.remainingMs ?? 0;
}

function poseRange(reclaim: RecoveryReclaim): Record<string, unknown> {
  return { pose: reclaim.pose, range: reclaim.distance };
}
