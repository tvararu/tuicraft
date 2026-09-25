import { pause } from "lib/abort";
import type { ControlEvent } from "wow/control";
import { legDetail, walkToCorpse } from "wow/corpse-legs";
import { type CycleStop, cycleStop as stop } from "wow/cycle-stop";
import type { CycleDeps } from "wow/encounter-cycle";
import type { EventWaiter } from "wow/event-waiter";
import type { PlayerLife } from "wow/player-state";
import type { RecoveryEvent, RecoveryState } from "wow/recovery";

const RECLAIM_MARGIN_MS = 2000;
const RECOVERY_WAIT_MS = 30_000;

export type CorpseRun = Pick<CycleDeps, "recovery" | "control"> & {
  events: EventWaiter<RecoveryEvent>;
  motion: EventWaiter<ControlEvent>;
  signal: AbortSignal;
};

type Done = { ok: true } | CycleStop;
type Observed = { ok: true; state: RecoveryState } | CycleStop;

const DONE = { ok: true } as const;

export async function recoverCorpse(run: CorpseRun): Promise<CycleStop> {
  if (run.recovery.snapshot().resurrection?.response === "unanswered")
    return acceptResurrection(run);
  const ghost = await becomeGhost(run);
  if (!ghost.ok) return ghost;
  const corpse = await findCorpse(run);
  if (!corpse.ok) return corpse;
  const walked = await walkToCorpse(run, corpse.position);
  if (!walked.ok) return walked;
  const ready = await awaitReclaim(run);
  if (!ready.ok) return ready;
  const detail = legDetail(ready.state.reclaim, walked.legs);
  run.recovery.reclaimCorpse();
  const alive = await confirmLife(run, "alive", "reclaim_not_confirmed");
  return alive.ok ? stop("reclaimed", detail) : alive;
}

async function acceptResurrection(run: CorpseRun): Promise<CycleStop> {
  run.recovery.respondResurrection(true);
  const alive = await confirmLife(run, "alive", "resurrection_not_confirmed");
  return alive.ok ? stop("resurrected") : alive;
}

async function becomeGhost(run: CorpseRun): Promise<Done> {
  const life = run.recovery.snapshot().life;
  if (life === "ghost") return DONE;
  if (life !== "dead") return stop("life_unknown");
  run.recovery.releaseSpirit();
  return await confirmLife(run, "ghost", "ghost_not_confirmed");
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

type Found = { ok: true; position: { x: number; y: number; z: number } };

async function findCorpse(run: CorpseRun): Promise<Found | CycleStop> {
  run.recovery.queryCorpse();
  const queried = await run.events.find(
    (event) => event.type === "corpse_observed",
    RECOVERY_WAIT_MS,
    run.signal,
  );
  if (!queried) return stop("corpse_query_timeout");
  const { corpse, reclaim } = queried.state;
  if (corpse.status !== "found") return stop("corpse_absent");
  if (reclaim.reason === "corpse_map_mismatch")
    return stop("corpse_out_of_range", legDetail(reclaim, 0));
  return { ok: true, position: corpse.position };
}

async function awaitReclaim(run: CorpseRun): Promise<Observed> {
  let state = run.recovery.snapshot();
  for (let attempt = 0; attempt < 2 && remaining(state) > 0; attempt++) {
    await pause(remaining(state) + RECLAIM_MARGIN_MS, run.signal);
    state = run.recovery.snapshot();
  }
  if (remaining(state) > 0) return stop("reclaim_delayed");
  if (!state.reclaim.canRequest)
    return stop(
      state.reclaim.reason ?? "reclaim_blocked",
      legDetail(state.reclaim, 0),
    );
  return { ok: true, state };
}

function remaining(state: RecoveryState): number {
  return state.reclaim.remainingMs ?? 0;
}
