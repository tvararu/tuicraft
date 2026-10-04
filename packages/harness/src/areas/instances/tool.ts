import type { PartyState } from "@peon/core";
import { isLfgDo, runLfg } from "#harness/areas/instances/tool-lfg";
import {
  type DungeonAfter,
  type DungeonCtx,
  emptyDungeon,
  refusalOf,
  refusedOutcome,
} from "#harness/areas/instances/tool-lfg-base";
import {
  type DungeonArgs,
  dungeonParams,
} from "#harness/areas/instances/tool-params";
import {
  difficultyLines,
  difficultyName,
  type InstancesSnapshot,
  type LfgSnapshot,
  lockStale,
  type RaidLockView,
} from "#harness/areas/instances/tool-status";
import type { ToolResult } from "#harness/contract/result";
import { Refusal } from "#harness/ops/refusal";
import { defineGameTool, result } from "#harness/tools/define";
import type { GameToolSpec, ToolRenderers } from "#harness/tools/game-tool";
import { savesLine } from "#harness/tools/look-saves";
import { nextCall } from "#harness/tools/next-call";
import { argText } from "#harness/ui/draw";
import {
  type CallInit,
  callLine,
  callRenderer,
  resultRenderer,
} from "#harness/ui/renderers/line";

export type DungeonDo =
  | "status"
  | "difficulty"
  | "reset"
  | "bind"
  | "extend"
  | "queue"
  | "leave_queue"
  | "answer"
  | "roles"
  | "teleport"
  | "kick_vote";

type Snapshots = {
  instances: InstancesSnapshot;
  lfg: LfgSnapshot;
  party: PartyState;
};

function snapshotsOf(ctx: DungeonCtx): Snapshots {
  return {
    instances: ctx.handle.instances.state(),
    lfg: ctx.handle.lfg.state(),
    party: ctx.handle.getPartyState(),
  };
}

const RAID_VALUE: Readonly<Record<string, number>> = {
  "10": 0,
  "10-heroic": 2,
  "10-normal": 0,
  "25": 1,
  "25-heroic": 3,
  "25-normal": 1,
};

function difficultyValue(
  kind: "dungeon" | "raid",
  value: string,
): number | undefined {
  if (kind === "dungeon") {
    if (value === "normal") return 0;
    if (value === "heroic") return 1;
    return undefined;
  }
  return RAID_VALUE[value];
}

async function refreshSaves(
  ctx: DungeonCtx,
  instances: InstancesSnapshot,
): Promise<{ instances: InstancesSnapshot; refreshed: boolean }> {
  const outcome = await ctx.handle.instances.act.requestLockouts();
  if (outcome.status !== "ok") return { instances, refreshed: false };
  const next = snapshotsOf(ctx).instances;
  return { instances: { ...next, locks: outcome.locks }, refreshed: true };
}

function statusAfter(
  ctx: DungeonCtx,
  snapshots: Snapshots,
  refreshed: boolean,
): ToolResult<DungeonAfter> {
  const now = ctx.rt.clock.now();
  const lines = difficultyLines(snapshots.instances, now);
  if (!refreshed) lines.push("The save list did not refresh.");
  const saves = savesLine(
    snapshots.instances,
    snapshots.lfg,
    now,
    snapshots.party,
  );
  const detailLine =
    lines.find((line) => line.startsWith("Here:")) ??
    lines[0] ??
    "No saved instances.";
  return result("DONE", {
    after: {
      detail: detailLine,
      do: "status",
      refreshed,
      saves,
      status: "DONE",
    },
    body: [...lines, ...saves],
    detail: detailLine,
  });
}

async function runStatus(ctx: DungeonCtx): Promise<ToolResult<DungeonAfter>> {
  const first = snapshotsOf(ctx);
  if (!lockStale(first.instances, ctx.rt.clock.now()))
    return statusAfter(ctx, first, true);
  const refreshed = await ctx.rt.mutex.run(() =>
    refreshSaves(ctx, snapshotsOf(ctx).instances),
  );
  const second = snapshotsOf(ctx);
  return statusAfter(
    ctx,
    { instances: refreshed.instances, lfg: second.lfg, party: second.party },
    refreshed.refreshed,
  );
}

type Reply = {
  afterDetail?: string;
  body: string[];
  detail: string;
  reason?: string;
};

function reply(
  status: "DONE" | "PARTLY" | "UNCONFIRMED",
  verb: DungeonDo,
  { afterDetail, body, detail, reason }: Reply,
): ToolResult<DungeonAfter> {
  return result(status, {
    after: {
      detail: afterDetail ?? detail,
      do: verb,
      refreshed: false,
      saves: [],
      status,
    },
    body,
    detail,
    ...(reason === undefined ? {} : { reason }),
  });
}

const NO_DIFFICULTY_ARGS =
  "Difficulty needs for and value: dungeon normal or heroic, raid 10, 25, 10-heroic or 25-heroic.";
const RAID_SIZE =
  "Raid difficulty needs a size: 10, 25, 10-heroic or 25-heroic";

function checkDifficulty(
  kind: "dungeon" | "raid" | undefined,
  value: string | undefined,
): { kind: "dungeon" | "raid"; wire: number } {
  if (kind === undefined || value === undefined)
    return refusedOutcome(
      "missing_args",
      kind === "raid" ? `${RAID_SIZE}.` : NO_DIFFICULTY_ARGS,
    );
  const wire = difficultyValue(kind, value);
  if (wire === undefined)
    return refusedOutcome(
      "bad_value",
      kind === "raid"
        ? `${RAID_SIZE}, not ${value}.`
        : `Dungeon difficulty is normal or heroic, not ${value}.`,
    );
  return { kind, wire };
}

type DifficultyOutcome =
  | { status: "ok"; result: "changed" }
  | { status: "refused"; reason: string }
  | { status: "no_answer" }
  | { status: "unconfirmed_solo" }
  | { status: "nothing_to_reset" };

function difficultyResult(
  kind: "dungeon" | "raid",
  name: string,
  outcome: DifficultyOutcome,
): ToolResult<DungeonAfter> {
  const label = kind === "dungeon" ? "Dungeon" : "Raid";
  if (outcome.status === "ok")
    return reply("DONE", "difficulty", {
      afterDetail: `${kind} difficulty set to ${name}.`,
      body: [`${label} difficulty is now ${name}.`],
      detail: `${label} difficulty set to ${name}.`,
    });
  const sent = `Difficulty change to ${name} was sent.`;
  if (outcome.status === "unconfirmed_solo") {
    const text = `Changed ${kind} difficulty to ${name}; the server does not confirm a solo change; it shows on your next dungeon entry.`;
    return reply("UNCONFIRMED", "difficulty", {
      afterDetail: sent,
      body: [text],
      detail: text,
      reason: "unconfirmed_solo",
    });
  }
  if (outcome.status === "no_answer") {
    const text = `The server did not answer the ${kind} difficulty change to ${name}.`;
    return reply("UNCONFIRMED", "difficulty", {
      afterDetail: sent,
      body: [text],
      detail: text,
      reason: "no_answer",
    });
  }
  if (outcome.status === "refused")
    return refusedOutcome(
      outcome.reason,
      outcome.reason === "not_leader"
        ? `Only the group leader can change ${kind} difficulty.`
        : `${kind} difficulty to ${name} was refused (${outcome.reason}).`,
    );
  throw new Error(`unexpected difficulty outcome ${outcome.status}`);
}

async function runDifficulty(
  ctx: DungeonCtx,
  forKind: "dungeon" | "raid" | undefined,
  value: string | undefined,
): Promise<ToolResult<DungeonAfter>> {
  const { kind, wire } = checkDifficulty(forKind, value);
  const outcome = await ctx.rt.mutex.run(() =>
    ctx.handle.instances.act.setDifficulty({ kind, value: wire }),
  );
  return difficultyResult(kind, difficultyName(kind, wire), outcome);
}

async function runReset(ctx: DungeonCtx): Promise<ToolResult<DungeonAfter>> {
  const outcome = await ctx.rt.mutex.run(() =>
    ctx.handle.instances.act.resetInstances(),
  );
  if (outcome.status === "nothing_to_reset")
    return reply("DONE", "reset", {
      body: ["No dungeons needed a reset."],
      detail: "There was nothing to reset.",
      reason: "nothing_to_reset",
    });
  if (outcome.status === "refused")
    return refusedOutcome(
      outcome.reason,
      outcome.reason === "not_leader"
        ? "Only the group leader can reset dungeons."
        : `Reset refused (${outcome.reason}).`,
    );
  if (outcome.status !== "ok")
    throw new Error(`unexpected reset outcome ${outcome.status}`);
  const reset = [...outcome.reset];
  const failed = [...outcome.failed];
  const body = [
    ...reset.map((mapId) => `map ${mapId} was reset.`),
    ...failed.map((mapId) => `map ${mapId} stayed inside and was not reset.`),
  ];
  const detail = body.join(" ");
  if (failed.length === 0) return reply("DONE", "reset", { body, detail });
  if (reset.length === 0)
    throw new Refusal({
      detail: `${detail} Leave the dungeon first, for example with your hearthstone.`,
      next: nextCall("travel", { to: "hearth" }),
      reason: "reset_failed",
    });
  return reply("PARTLY", "reset", { body, detail });
}

async function runBind(
  ctx: DungeonCtx,
  accept: boolean | undefined,
): Promise<ToolResult<DungeonAfter>> {
  const keep = accept ?? true;
  const outcome = await ctx.rt.mutex.run(() =>
    ctx.handle.instances.act.answerBind(keep),
  );
  if (outcome.status === "ok") {
    const detail = keep
      ? "Accepted the instance save."
      : "Refused the instance save.";
    return reply("DONE", "bind", {
      body: [
        keep
          ? "You are now saved to this instance."
          : "You refused the save and keep your old bind.",
      ],
      detail,
    });
  }
  if (outcome.status === "no_answer")
    return reply("UNCONFIRMED", "bind", {
      afterDetail: "The bind answer was sent.",
      body: ["The server did not answer the bind choice."],
      detail: "The server did not answer the bind choice.",
      reason: "no_answer",
    });
  if (outcome.status === "refused")
    return refusedOutcome(
      outcome.reason,
      outcome.reason === "no_bind_offer"
        ? "No instance save prompt is open."
        : `The bind answer was refused (${outcome.reason}).`,
    );
  throw new Error(`unexpected bind outcome ${outcome.status}`);
}

function pickLock(
  locks: readonly RaidLockView[],
  map: number | undefined,
  value: string | undefined,
): RaidLockView {
  if (map === undefined)
    return refusedOutcome(
      "missing_args",
      "Extend needs the map id of the saved lock.",
    );
  const held = locks.filter((lock) => lock.mapId === map);
  const first = held[0];
  if (first === undefined)
    return refusedOutcome(
      "no_matching_lock",
      `No save is held for map ${map}.`,
    );
  if (value === undefined) {
    if (held.length > 1)
      return refusedOutcome(
        "ambiguous",
        `Map ${map} has ${held.length} saves; name one with value 10, 25, 10-heroic or 25-heroic.`,
      );
    return first;
  }
  const wire = RAID_VALUE[value];
  const picked = held.find((lock) => lock.difficulty === wire);
  if (wire === undefined || picked === undefined)
    return refusedOutcome(
      "bad_value",
      `Map ${map} has no save with difficulty ${value}.`,
    );
  return picked;
}

type ExtendOutcome =
  | { status: "ok" }
  | { status: "refused"; reason: string }
  | { status: "no_answer" }
  | { status: "unconfirmed_solo" }
  | { status: "nothing_to_reset" };

function extendResult(
  map: number,
  want: boolean,
  outcome: ExtendOutcome,
): ToolResult<DungeonAfter> {
  if (outcome.status === "ok") {
    const text = `Map ${map} lock ${want ? "extended." : "shortened."}`;
    return reply("DONE", "extend", {
      afterDetail: `Map ${map} lock ${want ? "extended" : "shortened"}.`,
      body: [text],
      detail: text,
    });
  }
  if (outcome.status === "no_answer") {
    const text = `The server did not answer the extend choice for map ${map}.`;
    return reply("UNCONFIRMED", "extend", {
      afterDetail: `Map ${map} extend answer was sent.`,
      body: [text],
      detail: text,
      reason: "no_answer",
    });
  }
  if (outcome.status === "refused")
    return refusedOutcome(
      outcome.reason,
      `Extending map ${map} was refused (${outcome.reason}).`,
    );
  throw new Error(`unexpected extend outcome ${outcome.status}`);
}

async function runExtend(
  ctx: DungeonCtx,
  map: number | undefined,
  extended: boolean | undefined,
  value: string | undefined,
): Promise<ToolResult<DungeonAfter>> {
  const picked = pickLock(ctx.handle.instances.state().locks ?? [], map, value);
  const want = extended ?? true;
  const outcome = await ctx.rt.mutex.run(() =>
    ctx.handle.instances.act.setLockoutExtended({
      difficulty: picked.difficulty,
      extended: want,
      mapId: picked.mapId,
    }),
  );
  return extendResult(picked.mapId, want, outcome);
}

export function runDungeon(
  args: DungeonArgs,
  ctx: DungeonCtx,
): Promise<ToolResult<DungeonAfter>> {
  const do_ = (args.do ?? "status") as DungeonDo;
  if (do_ === "status") return runStatus(ctx);
  if (do_ === "difficulty")
    return runDifficulty(
      ctx,
      args.for === "dungeon" || args.for === "raid" ? args.for : undefined,
      args.value,
    );
  if (do_ === "reset") return runReset(ctx);
  if (do_ === "bind") return runBind(ctx, args.accept);
  if (do_ === "extend")
    return runExtend(ctx, args.map, args.extended, args.value);
  if (isLfgDo(do_)) return runLfg(do_, args, ctx);
  return Promise.reject(
    refusalOf(
      "unknown_verb",
      `Unknown dungeon verb ${String(do_)}. Use status, difficulty, reset, bind, extend, queue, leave_queue, answer, roles, teleport or kick_vote.`,
    ),
  );
}

function dungeonCall(args: unknown, theme: CallInit["theme"]): string {
  return callLine({
    icon: "clock",
    parts: [
      argText(args, "do") ?? "status",
      argText(args, "for"),
      argText(args, "value"),
    ],
    theme,
    verb: "dungeon",
  });
}

function dungeonBody({
  after,
  expanded,
}: {
  after: DungeonAfter;
  expanded: boolean;
}): string[] {
  if (!expanded) return [];
  return [...after.saves];
}

export const dungeonRenderers: ToolRenderers<"dungeon", DungeonAfter> = {
  renderCall: callRenderer(dungeonCall),
  renderResult: resultRenderer("dungeon", dungeonBody),
};

export const dungeonSpec: GameToolSpec<
  typeof dungeonParams,
  "dungeon",
  DungeonAfter
> = {
  fallback: emptyDungeon,
  kind: "action",
  minimalArgs: {},
  name: "dungeon",
  parameters: dungeonParams,
  renderers: dungeonRenderers,
  run: runDungeon,
  text: {
    description:
      "Shows dungeon and raid difficulty, saved instances and the dungeon finder queue. It sets difficulty, resets dungeons, answers the save prompt, extends raid locks, joins and leaves the dungeon finder, answers role checks and proposals, teleports in and out and votes on kicks.",
    guidelines: [
      "Only the group leader can change difficulty or reset dungeons.",
    ],
    label: "Dungeon",
  },
};

export const dungeonTool = defineGameTool(dungeonSpec);
