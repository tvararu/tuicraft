import type { RunRecord, RunRegistry, StopCause } from "#harness/contract/runs";
import type {
  HarnessRuntime,
  RuntimeParts,
  SessionFlags,
} from "#harness/contract/services";
import type { Game } from "#harness/loops/game";
import { type Connection, createConnection } from "#harness/runtime/connection";
import {
  type ControlArbiter,
  createControlArbiter,
} from "#harness/runtime/control-owner";

export function createHarnessRuntime(parts: RuntimeParts): HarnessRuntime {
  const { login, ...rest } = parts;
  const observers = [
    parts.ready,
    parts.router,
    parts.sightings,
    parts.attacks,
    parts.progress,
    parts.snapshots,
  ];
  const link = createConnection({
    clock: parts.clock,
    log: parts.log,
    login,
    observers,
    profile: parts.profile,
    runs: parts.runs,
  });
  const stopAll = (cause: StopCause) =>
    stopEverything(parts.runs, link.handle(), cause);
  const control = ownership(stopAll);
  const shutdown = () => shutdownAll({ link, parts, stopAll });
  return {
    ...rest,
    ...link,
    control,
    session: initialSession(parts.flags.wake),
    shutdown,
    stopAll,
  };
}

function ownership(stopAll: (cause: StopCause) => RunRecord[]): ControlArbiter {
  return createControlArbiter(({ by }) =>
    stopAll(by === "human" ? "human" : "tool"),
  );
}

function initialSession(wake: boolean): SessionFlags {
  return {
    agent: "idle",
    agentGrant: undefined,
    humanTexts: [],
    humanWaiting: false,
    lastNow: undefined,
    lastToolCallAt: undefined,
    replyStarted: false,
    tool: undefined,
    turnStartSeq: 0,
    turnToolCalls: 0,
    unreadWhispers: 0,
    wake,
  };
}

function stopEverything(
  runs: RunRegistry,
  handle: Game | undefined,
  cause: StopCause,
): RunRecord[] {
  const stopped = runs.cancelAll(cause);
  handle?.halt();
  handle?.stopCycle();
  handle?.stopAttack();
  return stopped;
}

type Shutdown = {
  parts: RuntimeParts;
  link: Connection;
  stopAll: (cause: StopCause) => RunRecord[];
};

async function shutdownAll({ parts, link, stopAll }: Shutdown): Promise<void> {
  stopAll("quit");
  await link.disconnect();
  await parts.log.flush();
  await parts.jevLog.close();
  await parts.stats.stop();
}
