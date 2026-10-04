import {
  answerOpenRoleCheck,
  startWatch,
  stopWatch,
} from "#harness/areas/instances/tool-lfg-auto";
import {
  type DungeonAfter,
  type DungeonCtx,
  entryName,
  entryType,
  hasRole,
  type LfgState,
  queueScope,
  RANDOM_DUNGEON_TYPE,
  refusedOutcome,
  roleNames,
  rolesToBits,
} from "#harness/areas/instances/tool-lfg-base";
import type { ToolResult } from "#harness/contract/result";
import { selfView } from "#harness/ops/views";

export type LfgDo =
  | "queue"
  | "leave_queue"
  | "answer"
  | "roles"
  | "teleport"
  | "kick_vote";

export function isLfgDo(do_: string): do_ is LfgDo {
  return (
    do_ === "queue" ||
    do_ === "leave_queue" ||
    do_ === "answer" ||
    do_ === "roles" ||
    do_ === "teleport" ||
    do_ === "kick_vote"
  );
}

function unlockedRandom(state: LfgState): number | undefined {
  const locked = new Map(
    state.locks.map((lock) => [lock.entry, lock.status] as const),
  );
  return state.available.find(
    (dungeon) =>
      entryType(dungeon.entry) === RANDOM_DUNGEON_TYPE &&
      (locked.get(dungeon.entry) ?? 0) === 0,
  )?.entry;
}

function dungeonLabel(entry: number | undefined): string {
  if (entry === undefined) return "";
  return entryType(entry) === RANDOM_DUNGEON_TYPE
    ? " for a random dungeon"
    : ` for ${entryName(entry)}`;
}

function queueRefused(reason: string, detail: string): never {
  return refusedOutcome(reason, detail);
}

async function pickEntries(
  ctx: DungeonCtx,
  dungeon: number | undefined,
): Promise<
  { entry: number } | { refused: { reason: string; detail: string } }
> {
  const state = ctx.handle.lfg.state();
  if (dungeon !== undefined) {
    const known =
      state.available.some((view) => view.entry === dungeon) ||
      state.locks.some((lock) => lock.entry === dungeon);
    if (!known)
      return {
        refused: {
          detail: `No dungeon finder entry ${dungeon} is offered.`,
          reason: "unknown_dungeon",
        },
      };
    return { entry: dungeon };
  }
  const listed = unlockedRandom(state);
  if (listed !== undefined) return { entry: listed };
  const outcome = await ctx.rt.mutex.run(() =>
    ctx.handle.lfg.act.requestDungeons(),
  );
  if (outcome.status !== "ok")
    return {
      refused: {
        detail: "The dungeon finder list did not answer.",
        reason: "no_answer",
      },
    };
  const next = unlockedRandom(ctx.handle.lfg.state());
  if (next === undefined)
    return {
      refused: {
        detail: "No unlocked random dungeon is offered.",
        reason: "no_random_dungeon",
      },
    };
  return { entry: next };
}

function queueResultText(
  entry: number,
  roles: number,
  roleCheck: boolean,
  scope: string,
): string {
  const answered = roleCheck
    ? ' A role check opened with it; answer with dungeon(do: "roles").'
    : "";
  return `Queued ${scope}${dungeonLabel(entry)} as ${roleNames(roles)}.${answered}`;
}

function playable(roles: number): boolean {
  return (
    hasRole(roles, "tank") ||
    hasRole(roles, "healer") ||
    hasRole(roles, "damage")
  );
}

async function runQueue(
  ctx: DungeonCtx,
  args: { dungeon?: number; roles?: readonly string[]; auto?: boolean },
): Promise<ToolResult<DungeonAfter>> {
  const state = ctx.handle.lfg.state();
  if (state.status === "queued" || state.status === "proposal")
    return queueRefused(
      "already_queued",
      "Already queued for the dungeon finder.",
    );
  const roles = rolesToBits(args.roles);
  if (!playable(roles))
    return queueRefused(
      "no_role",
      "Queue needs a role: tank, healer or damage.",
    );
  const picked = await pickEntries(ctx, args.dungeon);
  if ("refused" in picked)
    return queueRefused(picked.refused.reason, picked.refused.detail);
  const entry = picked.entry;
  const auto = args.auto ?? true;
  startWatch(ctx, { entries: [entry], roles }, auto);
  const outcome = await ctx.rt.mutex
    .run(() =>
      ctx.handle.lfg.act.join({ comment: "", entries: [entry], roles }),
    )
    .catch((error: unknown) => {
      stopWatch(ctx);
      throw error;
    });
  if (outcome.status !== "ok") {
    stopWatch(ctx);
    return queueRefused(
      outcome.status === "refused" ? outcome.reason : "no_answer",
      outcome.status === "refused"
        ? `The dungeon finder refused the queue (${outcome.reason}).`
        : "The dungeon finder did not answer the queue.",
    );
  }
  if (outcome.roleCheck) answerOpenRoleCheck(ctx);
  const scope = queueScope(ctx.handle.getPartyState());
  const text = queueResultText(entry, roles, outcome.roleCheck, scope);
  return {
    after: {
      detail: text,
      do: "queue",
      refreshed: false,
      saves: [],
      status: "DONE",
    },
    body: [text],
    detail: text,
    status: "DONE",
  };
}

function lfgReply(
  verb: string,
  body: string,
  extra?: { reason?: string; status?: "DONE" | "PARTLY" | "UNCONFIRMED" },
): ToolResult<DungeonAfter> {
  const status = extra?.status ?? "DONE";
  return {
    after: { detail: body, do: verb, refreshed: false, saves: [], status },
    body: [body],
    detail: body,
    status,
    ...(extra?.reason === undefined ? {} : { reason: extra.reason }),
  };
}

async function runLeaveQueue(
  ctx: DungeonCtx,
): Promise<ToolResult<DungeonAfter>> {
  const outcome = await ctx.rt.mutex.run(() => ctx.handle.lfg.act.leave());
  if (outcome.status !== "ok")
    return refusedOutcome(
      outcome.status === "refused" ? outcome.reason : "no_answer",
      outcome.status === "refused"
        ? `Leaving the queue was refused (${outcome.reason}).`
        : "The dungeon finder did not answer leaving the queue.",
    );
  stopWatch(ctx);
  return lfgReply("leave_queue", "Left the dungeon finder queue.");
}

async function runAnswer(
  ctx: DungeonCtx,
  accept: boolean | undefined,
): Promise<ToolResult<DungeonAfter>> {
  const keep = accept ?? true;
  const outcome = await ctx.rt.mutex.run(() =>
    ctx.handle.lfg.act.answerProposal(keep),
  );
  if (outcome.status !== "ok")
    return refusedOutcome(
      outcome.status === "refused" ? outcome.reason : "no_answer",
      outcome.status === "refused"
        ? `The proposal answer was refused (${outcome.reason}).`
        : "The dungeon finder did not answer the proposal.",
    );
  stopWatch(ctx);
  return lfgReply(
    "answer",
    keep
      ? "Accepted the dungeon group proposal."
      : "Declined the dungeon group proposal.",
  );
}

async function runRoles(
  ctx: DungeonCtx,
  roles: readonly string[] | undefined,
): Promise<ToolResult<DungeonAfter>> {
  const bits = rolesToBits(roles);
  if (!playable(bits))
    return queueRefused(
      "no_role",
      "Answer needs a role: tank, healer or damage.",
    );
  const outcome = await ctx.rt.mutex.run(() =>
    ctx.handle.lfg.act.setRoles(bits),
  );
  if (outcome.status !== "ok")
    return refusedOutcome(
      outcome.status === "refused" ? outcome.reason : "no_answer",
      outcome.status === "refused"
        ? `The role answer was refused (${outcome.reason}).`
        : "The dungeon finder did not answer the role choice.",
    );
  stopWatch(ctx);
  return lfgReply("roles", `Answered the role check as ${roleNames(bits)}.`);
}

async function runTeleport(
  ctx: DungeonCtx,
  to: "in" | "out" | undefined,
): Promise<ToolResult<DungeonAfter>> {
  if (to === undefined)
    return queueRefused("missing_args", "Teleport needs to in or out.");
  const life = selfView(ctx).life;
  if (to === "in" && life !== "alive")
    return queueRefused(
      "dead",
      "The dungeon finder cannot bring a ghost back; walk to the dungeon entrance.",
    );
  const outcome = await ctx.rt.mutex.run(() =>
    ctx.handle.lfg.act.teleport(to === "out", undefined),
  );
  if (outcome.status !== "ok") {
    if (outcome.status === "no_answer")
      return lfgReply("teleport", "The dungeon teleport was sent.", {
        reason: "no_answer",
        status: "UNCONFIRMED",
      });
    return refusedOutcome(
      outcome.reason,
      `The dungeon teleport was refused (${outcome.reason}).`,
    );
  }
  return lfgReply(
    "teleport",
    to === "in"
      ? "Teleported into the dungeon."
      : "Teleported out of the dungeon.",
  );
}

async function runKickVote(
  ctx: DungeonCtx,
  accept: boolean | undefined,
): Promise<ToolResult<DungeonAfter>> {
  if (accept === undefined)
    return queueRefused(
      "missing_args",
      "Kick vote needs accept true or false.",
    );
  const outcome = await ctx.rt.mutex.run(() =>
    ctx.handle.lfg.act.voteKick(accept),
  );
  if (outcome.status !== "ok")
    return refusedOutcome(
      outcome.status === "refused" ? outcome.reason : "no_answer",
      outcome.status === "refused"
        ? `The kick vote was refused (${outcome.reason}).`
        : "The dungeon finder did not answer the kick vote.",
    );
  return lfgReply(
    "kick_vote",
    accept ? "Voted to kick the player." : "Voted against the kick.",
  );
}

export function runLfg(
  do_: LfgDo,
  args: {
    accept?: boolean;
    auto?: boolean;
    dungeon?: number;
    roles?: readonly string[];
    to?: string;
  },
  ctx: DungeonCtx,
): Promise<ToolResult<DungeonAfter>> {
  if (do_ === "queue") return runQueue(ctx, args);
  if (do_ === "leave_queue") return runLeaveQueue(ctx);
  if (do_ === "answer") return runAnswer(ctx, args.accept);
  if (do_ === "roles") return runRoles(ctx, args.roles);
  if (do_ === "teleport")
    return runTeleport(
      ctx,
      args.to === "in" || args.to === "out" ? args.to : undefined,
    );
  return runKickVote(ctx, args.accept);
}
