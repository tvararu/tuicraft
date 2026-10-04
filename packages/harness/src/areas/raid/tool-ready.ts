import {
  type ReadyCheck,
  readyOutcome,
} from "#harness/areas/raid/tool-ready-outcome";
import { needGroup, runRaidSettled } from "#harness/areas/raid/tool-settle";
import {
  type Answer,
  emptyGroup,
  type GroupAfter,
  type GroupArgs,
  type GroupCtx,
  type GroupDo,
  isAssistant,
  isLeader,
  KICK_SETTLE_MS,
  type RaidGroup,
} from "#harness/areas/raid/tool-shared";
import type { ToolResult } from "#harness/contract/result";
import { Refusal } from "#harness/ops/refusal";
import { settle } from "#harness/ops/settle";
import { result } from "#harness/tools/define";

const READY_STATES: Record<string, boolean> = { no: false, yes: true };

function readyArgs(args: GroupArgs): boolean {
  const named = args.what?.trim().toLowerCase() ?? "";
  if (!Object.hasOwn(READY_STATES, named))
    throw new Refusal({
      detail: "answer the ready check with yes or no.",
      next: "end your turn.",
      reason: "bad_answer",
    });
  return named === "yes";
}

function readyCheck(group: RaidGroup, ctx: GroupCtx): void {
  if (group.dungeonFinder !== undefined)
    throw new Refusal({
      detail: "the dungeon finder runs this group's votes.",
      next: "end your turn.",
      reason: "lfg_vote",
    });
  if (!(isLeader(group, ctx) || isAssistant(group, ctx)))
    throw new Refusal({
      detail: "only the leader or an assistant starts a ready check.",
      next: "end your turn.",
      reason: "not_leader",
    });
}

export const READY_CHECK_TIMEOUT_MS = 30_000;

function currentCheck(
  ctx: GroupCtx,
): { check: ReadyCheck; group: RaidGroup } | undefined {
  const state = ctx.handle.raid.state();
  const group = state.group;
  const check = state.readyCheck;
  if (!(group && check)) return undefined;
  return { check, group };
}

function superseded(): ToolResult<GroupAfter> {
  return result("UNCONFIRMED", {
    after: after("ready_check", false),
    detail:
      "another leader or assistant started a new ready check, so the outcome of yours is unknown.",
    next: "check group status for the latest ready check.",
    reason: "superseded",
  });
}

function finishedOutcome(
  ctx: GroupCtx,
  id: number | undefined,
): ToolResult<GroupAfter> | undefined {
  const current = currentCheck(ctx);
  if (current === undefined) return undefined;
  if (id !== undefined && current.check.id !== id) return superseded();
  if (current.check.finishedAt === undefined) return undefined;
  return result("DONE", {
    after: after("ready_check", true),
    detail: `The ready check finished: ${readyOutcome(current.group, current.check)}.`,
  });
}

async function waitReadyDone(ctx: GroupCtx): Promise<void> {
  await settle<Answer>({
    match: (answer) =>
      answer?.kind === "raid" &&
      (answer.event.type === "ready_check_finished" ||
        answer.event.type === "ready_check_started"),
    signal: ctx.signal,
    subscribe: (cb) =>
      ctx.handle.raid.onEvent((event) => cb({ event, kind: "raid" })),
    timeoutMs: READY_CHECK_TIMEOUT_MS + KICK_SETTLE_MS,
  });
}

function after(doing: GroupDo, confirmed: boolean): GroupAfter {
  return {
    ...emptyGroup(),
    confirmed,
    do: doing,
    member: undefined,
    to: undefined,
  };
}

export async function readyCheckTool(
  args: GroupArgs,
  ctx: GroupCtx,
): Promise<ToolResult<GroupAfter>> {
  const { group } = needGroup(ctx);
  readyCheck(group, ctx);
  const self = ctx.handle.getControlState().selfGuid;
  let startedId: number | undefined;
  const stop = ctx.handle.raid.onEvent((event) => {
    if (event.type !== "ready_check_started" || event.initiator !== self)
      return;
    startedId = ctx.handle.raid.state().readyCheck?.id;
  });
  try {
    return await startAndAwait(args, ctx, () => startedId);
  } finally {
    stop();
  }
}

async function startAndAwait(
  _args: GroupArgs,
  ctx: GroupCtx,
  startedId: () => number | undefined,
): Promise<ToolResult<GroupAfter>> {
  const self = ctx.handle.getControlState().selfGuid;
  const started = await runRaidSettled(
    ctx,
    () => ctx.handle.raid.act.startReadyCheck(),
    (answer) => {
      if (answer?.kind !== "raid") return;
      if (answer.event.type !== "ready_check_started") return;
      if (answer.event.initiator !== self) return;
      return {
        after: after("ready_check", true),
        detail: "ready check started.",
        status: "DONE" as const,
      };
    },
    {
      after: after("ready_check", false),
      detail: "the ready check start is not confirmed yet.",
      failedDetail: "the ready check failed to start.",
      next: "end your turn; a [game] message comes if the check starts.",
    },
  );
  if (started.status !== "DONE") return started;
  const early = finishedOutcome(ctx, startedId());
  if (early) return early;
  await waitReadyDone(ctx);
  const late = finishedOutcome(ctx, startedId());
  if (late) return late;
  const partial = currentCheck(ctx);
  if (!partial)
    return result("UNCONFIRMED", {
      after: after("ready_check", false),
      detail: "the ready check ended without an outcome.",
      next: "end your turn.",
      reason: "no_answer",
    });
  return result("UNCONFIRMED", {
    after: after("ready_check", false),
    detail: `The ready check finished: ${readyOutcome(partial.group, partial.check)}. The finish is not confirmed yet.`,
    next: "check group status for the latest answers.",
    reason: "no_answer",
  });
}

function openCheck(ctx: GroupCtx): void {
  const check = ctx.handle.raid.state().readyCheck;
  if (check === undefined || check.finishedAt !== undefined)
    throw new Refusal({
      detail: "no ready check is open.",
      next: "end your turn.",
      reason: "no_check",
    });
}

export async function readyTool(
  args: GroupArgs,
  ctx: GroupCtx,
): Promise<ToolResult<GroupAfter>> {
  needGroup(ctx);
  openCheck(ctx);
  const answer = readyArgs(args);
  await ctx.rt.mutex.run(() => ctx.handle.raid.act.answerReadyCheck(answer));
  return result("DONE", {
    after: after("ready", true),
    detail: answer ? "you are ready." : "you are not ready.",
  });
}
