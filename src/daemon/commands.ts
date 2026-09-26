import {
  formatNearbyLine,
  formatNearbyObj,
  prepareNearbyEntities,
} from "daemon/nearby";
import type { IpcCommand } from "daemon/parse";
import { messageOf } from "lib/errors";
import type { RingBuffer } from "lib/ring-buffer";
import {
  formatFriendList,
  formatFriendListJson,
  formatGuildRoster,
  formatGuildRosterJson,
  formatIgnoreList,
  formatIgnoreListJson,
  formatWhoResults,
  formatWhoResultsJson,
  jsonSafe,
} from "ui/format";
import {
  formatControlState,
  formatControlStateObj,
  nextStepFor,
} from "ui/format-control";
import {
  formatCycleState,
  formatExperienceState,
  formatInventoryState,
  formatRecoveryState,
  formatRewardsState,
} from "ui/format-gameplay";
import type { ChatMode, WorldHandle } from "wow/client";
import type { ControlState } from "wow/control";

export type EventEntry = { text: string | undefined; json: string };

export type IpcSocket = {
  write: (data: string | Uint8Array) => number;
  end: () => void;
};

export function writeLines(socket: IpcSocket, lines: string[]): void {
  for (const line of lines) socket.write(`${line}\n`);
  socket.write("\n");
}

function drainText(events: RingBuffer<EventEntry>): string[] {
  return events.drain().flatMap((e) => (e.text === undefined ? [] : [e.text]));
}

function drainJson(events: RingBuffer<EventEntry>): string[] {
  return events.drain().map((e) => e.json);
}

function sliceText(events: RingBuffer<EventEntry>, from: number): string[] {
  return events
    .slice(from)
    .flatMap((e) => (e.text === undefined ? [] : [e.text]));
}

function sliceJson(events: RingBuffer<EventEntry>, from: number): string[] {
  return events.slice(from).map((e) => e.json);
}

function waitUnlessAborted(ms: number, abort?: AbortSignal): Promise<boolean> {
  if (abort?.aborted) return Promise.resolve(true);
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const timer = setTimeout(() => resolve(false), ms);
  abort?.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      resolve(true);
    },
    { once: true },
  );
  return promise;
}

export type DispatchContext = {
  handle: WorldHandle;
  events: RingBuffer<EventEntry>;
  socket: IpcSocket;
  cleanup: () => void;
  abort?: AbortSignal;
};

type Handler<K extends IpcCommand["type"]> = (
  cmd: Extract<IpcCommand, { type: K }>,
  ctx: DispatchContext,
) => boolean | Promise<boolean>;

type Handlers = { [K in IpcCommand["type"]]: Handler<K> };

function chatModeLabel(mode: ChatMode): string {
  if (mode.type === "whisper") return `WHISPER ${mode.target}`;
  if (mode.type === "channel") return `CHANNEL ${mode.channel}`;
  return mode.type.toUpperCase();
}

function acknowledge(socket: IpcSocket): false {
  writeLines(socket, ["OK"]);
  return false;
}

function send(socket: IpcSocket, lines: string[]): false {
  writeLines(socket, lines);
  return false;
}

function readWait(
  ctx: DispatchContext,
  ms: number,
  drain: (events: RingBuffer<EventEntry>) => string[],
): Promise<false> {
  const { promise, resolve } = Promise.withResolvers<false>();
  const ready = drain(ctx.events);
  if (ready.length > 0 || ms === 0)
    return Promise.resolve(send(ctx.socket, ready));
  if (ctx.abort?.aborted) return Promise.resolve(false);
  const finish = (lines: string[] | undefined) => {
    clearTimeout(timer);
    unsubscribe();
    ctx.abort?.removeEventListener("abort", onAbort);
    if (lines) send(ctx.socket, lines);
    resolve(false);
  };
  const onAbort = () => finish(undefined);
  const timer = setTimeout(() => finish([]), ms);
  const unsubscribe = ctx.events.subscribe(() => {
    const lines = drain(ctx.events);
    if (lines.length > 0) finish(lines);
  });
  ctx.abort?.addEventListener("abort", onAbort, { once: true });
  return promise;
}

async function tailWait(
  ctx: DispatchContext,
  ms: number,
  slice: (events: RingBuffer<EventEntry>, from: number) => string[],
): Promise<false> {
  const start = ctx.events.writePos;
  const aborted = await waitUnlessAborted(ms, ctx.abort);
  if (aborted) return false;
  writeLines(ctx.socket, slice(ctx.events, start));
  return false;
}

function whoQuery(filter: string | undefined) {
  return filter ? { name: filter } : {};
}

async function guildRosterText({ handle, socket }: DispatchContext) {
  const roster = await handle.requestGuildRoster();
  if (roster) {
    writeLines(socket, formatGuildRoster(roster).split("\n"));
  } else {
    writeLines(socket, ["[guild] No guild roster available"]);
  }
  return false;
}

async function guildRosterJson({ handle, socket }: DispatchContext) {
  const roster = await handle.requestGuildRoster();
  if (roster) {
    writeLines(socket, [formatGuildRosterJson(roster)]);
  } else {
    writeLines(socket, [JSON.stringify({ members: [], type: "GUILD_ROSTER" })]);
  }
  return false;
}

const HANDLERS: Handlers = {
  abandon_quest: (cmd, { handle, socket }) =>
    reply(socket, () => handle.abandonQuest(cmd.slot), ok),
  accept: (_cmd, { handle, socket }) => {
    handle.acceptInvite();
    return acknowledge(socket);
  },
  accept_quest: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.acceptQuest(), ok),
  add_friend: (cmd, { handle, socket }) => {
    handle.addFriend(cmd.target);
    return acknowledge(socket);
  },
  add_ignore: (cmd, { handle, socket }) => {
    handle.addIgnore(cmd.target);
    return acknowledge(socket);
  },
  afk: (cmd, { handle, socket }) => {
    handle.sendAfk(cmd.message);
    return acknowledge(socket);
  },
  attack: (cmd, { handle, socket }) =>
    reply(socket, () => handle.attack(cmd.guid), ok),
  cancel_cast: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.cancelCast(), ok),
  cancel_interaction: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.cancelInteraction(), ok),
  cast: (cmd, { handle, socket }) =>
    reply(socket, () => handle.cast(cmd.spellId, cmd.guid), ok),
  chat: (cmd, { handle, socket }) => {
    handle.sendInCurrentMode(cmd.message);
    return send(socket, [`OK ${chatModeLabel(handle.getLastChatMode())}`]);
  },
  choose_reward: (cmd, { handle, socket }) =>
    reply(socket, () => handle.chooseQuestReward(cmd.index), ok),
  combat: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getCombatState(), pretty),
  combat_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getCombatState(), json),
  complete_quest: (cmd, { handle, socket }) =>
    reply(socket, () => handle.completeQuest(cmd.questId), ok),
  control: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getControlState(), controlText),
  control_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getControlState(), controlJson),
  cycle: (cmd, { handle, socket }) =>
    reply(
      socket,
      () => handle.startCycle(cmd.guids, cmd.instruction, cmd.maxStarts),
      ok,
    ),
  cycle_resume: (cmd, { handle, socket }) =>
    reply(socket, () => handle.resumeCycle(cmd.instruction, cmd.maxStarts), ok),
  cycling: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getCycleState(), formatCycleState),
  cycling_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getCycleState(), json),
  decline: (_cmd, { handle, socket }) => {
    handle.declineInvite();
    return acknowledge(socket);
  },
  del_friend: (cmd, { handle, socket }) => {
    handle.removeFriend(cmd.target);
    return acknowledge(socket);
  },
  del_ignore: (cmd, { handle, socket }) => {
    handle.removeIgnore(cmd.target);
    return acknowledge(socket);
  },
  dnd: (cmd, { handle, socket }) => {
    handle.sendDnd(cmd.message);
    return acknowledge(socket);
  },
  emote: (cmd, { handle, socket }) => {
    handle.sendEmote(cmd.message);
    return acknowledge(socket);
  },
  experience: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getExperienceState(), formatExperienceState),
  experience_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getExperienceState(), json),
  face: (cmd, { handle, socket }) =>
    reply(socket, () => handle.face(cmd.orientation), ok),
  face_guid: (cmd, { handle, socket }) =>
    reply(socket, () => handle.faceGuid(cmd.guid), ok),
  fight: (cmd, { handle, socket, abort }) =>
    reply(
      socket,
      () => handle.startTactics(cmd.guid, cmd.instruction, abort, cmd.framing),
      ok,
    ),
  friends: (_cmd, { handle, socket }) =>
    send(socket, formatFriendList(handle.getFriends()).split("\n")),
  friends_json: (_cmd, { handle, socket }) =>
    send(socket, [formatFriendListJson(handle.getFriends())]),
  goto: (cmd, { handle, socket }) =>
    reply(socket, () => handle.goTo(cmd.x, cmd.y, cmd.z), ok),
  guild: (cmd, { handle, socket }) => {
    handle.sendGuild(cmd.message);
    return acknowledge(socket);
  },
  guild_accept: (_cmd, { handle, socket }) => {
    handle.acceptGuildInvite();
    return acknowledge(socket);
  },
  guild_decline: (_cmd, { handle, socket }) => {
    handle.declineGuildInvite();
    return acknowledge(socket);
  },
  guild_demote: (cmd, { handle, socket }) => {
    handle.guildDemote(cmd.target);
    return acknowledge(socket);
  },
  guild_invite: (cmd, { handle, socket }) => {
    handle.guildInvite(cmd.target);
    return acknowledge(socket);
  },
  guild_kick: (cmd, { handle, socket }) => {
    handle.guildRemove(cmd.target);
    return acknowledge(socket);
  },
  guild_leader: (cmd, { handle, socket }) => {
    handle.guildLeader(cmd.target);
    return acknowledge(socket);
  },
  guild_leave: (_cmd, { handle, socket }) => {
    handle.guildLeave();
    return acknowledge(socket);
  },
  guild_motd: (cmd, { handle, socket }) => {
    handle.guildMotd(cmd.message);
    return acknowledge(socket);
  },
  guild_promote: (cmd, { handle, socket }) => {
    handle.guildPromote(cmd.target);
    return acknowledge(socket);
  },
  guild_roster: (_cmd, ctx) => guildRosterText(ctx),
  guild_roster_json: (_cmd, ctx) => guildRosterJson(ctx),
  halt: (_cmd, { handle, socket }) => reply(socket, () => handle.halt(), ok),
  ignored: (_cmd, { handle, socket }) =>
    send(socket, formatIgnoreList(handle.getIgnored()).split("\n")),
  ignored_json: (_cmd, { handle, socket }) =>
    send(socket, [formatIgnoreListJson(handle.getIgnored())]),
  invalid: (cmd, { socket }) => send(socket, [`ERR ${cmd.reason}`]),
  inventory: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getInventoryState(), formatInventoryState),
  inventory_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getInventoryState(), json),
  invite: (cmd, { handle, socket }) => {
    handle.invite(cmd.target);
    return acknowledge(socket);
  },
  join_channel: (cmd, { handle, socket }) => {
    handle.joinChannel(cmd.channel, cmd.password);
    return acknowledge(socket);
  },
  kick: (cmd, { handle, socket }) => {
    handle.uninvite(cmd.target);
    return acknowledge(socket);
  },
  leader: (cmd, { handle, socket }) => {
    handle.setLeader(cmd.target);
    return acknowledge(socket);
  },
  leave: (_cmd, { handle, socket }) => {
    handle.leaveGroup();
    return acknowledge(socket);
  },
  leave_channel: (cmd, { handle, socket }) => {
    handle.leaveChannel(cmd.channel);
    return acknowledge(socket);
  },
  loot: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getRewardsState(), formatRewardsState),
  loot_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getRewardsState(), json),
  move: (cmd, { handle, socket }) =>
    reply(socket, () => handle.move(cmd.direction, cmd.durationMs), ok),
  navigation: (_cmd, { handle, socket }) =>
    reply(socket, () => navigationObservation(handle), pretty),
  navigation_json: (_cmd, { handle, socket }) =>
    reply(socket, () => navigationObservation(handle), json),
  nearby: (cmd, { handle, socket }) =>
    send(socket, prepareNearbyEntities(handle, cmd.all).map(formatNearbyLine)),
  nearby_json: (cmd, { handle, socket }) =>
    send(
      socket,
      prepareNearbyEntities(handle, cmd.all).map((p) =>
        JSON.stringify(formatNearbyObj(p)),
      ),
    ),
  open_loot: (cmd, { handle, socket }) =>
    reply(socket, () => handle.openLoot(cmd.guid), ok),
  party: (cmd, { handle, socket }) => {
    handle.sendParty(cmd.message);
    return acknowledge(socket);
  },
  query_corpse: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.queryCorpse(), ok),
  query_quest: (cmd, { handle, socket }) =>
    reply(socket, () => handle.queryQuest(cmd.questId), ok),
  quests: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getQuestState(), pretty),
  quests_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getQuestState(), json),
  read: (_cmd, { events, socket }) => send(socket, drainText(events)),
  read_json: (_cmd, { events, socket }) => send(socket, drainJson(events)),
  read_wait: (cmd, ctx) => readWait(ctx, cmd.ms, drainText),
  read_wait_json: (cmd, ctx) => readWait(ctx, cmd.ms, drainJson),
  reclaim_corpse: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.reclaimCorpse(), ok),
  recovery: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getRecoveryState(), formatRecoveryState),
  recovery_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getRecoveryState(), json),
  release_loot: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.releaseLoot(), ok),
  release_spirit: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.releaseSpirit(), ok),
  request_reward: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.requestQuestReward(), ok),
  resurrect: (cmd, { handle, socket }) =>
    reply(socket, () => handle.respondResurrection(cmd.accept), ok),
  roll: (cmd, { handle, socket }) => {
    handle.sendRoll(cmd.min, cmd.max);
    return acknowledge(socket);
  },
  say: (cmd, { handle, socket }) => {
    handle.sendSay(cmd.message);
    return acknowledge(socket);
  },
  select_option: (cmd, { handle, socket }) =>
    reply(socket, () => handle.selectGossipOption(cmd.optionId, cmd.code), ok),
  select_quest: (cmd, { handle, socket }) =>
    reply(socket, () => handle.selectQuest(cmd.questId), ok),
  spells: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getSpellbook(), pretty),
  spells_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getSpellbook(), json),
  spirit_healer: (cmd, { handle, socket }) =>
    reply(socket, () => handle.activateSpiritHealer(cmd.guid), ok),
  status: (_cmd, { socket }) => send(socket, ["CONNECTED"]),
  stop: (_cmd, { socket, cleanup }) => {
    writeLines(socket, ["OK"]);
    cleanup();
    return true;
  },
  stop_attack: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.stopAttack(), ok),
  tactics: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getTacticsState(), pretty),
  tactics_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getTacticsState(), json),
  tail_wait: (cmd, ctx) => tailWait(ctx, cmd.ms, sliceText),
  tail_wait_json: (cmd, ctx) => tailWait(ctx, cmd.ms, sliceJson),
  take_loot: (cmd, { handle, socket }) =>
    reply(socket, () => handle.takeLoot(cmd.slot), ok),
  take_money: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.takeLootMoney(), ok),
  talk: (cmd, { handle, socket }) =>
    reply(socket, () => handle.talk(cmd.guid), ok),
  target: (cmd, { handle, socket }) =>
    reply(socket, () => handle.selectTarget(cmd.guid), ok),
  unimplemented: (cmd, { socket }) =>
    send(socket, [`UNIMPLEMENTED ${cmd.feature}`]),
  walk_toward: (cmd, { handle, socket, abort }) =>
    reply(socket, () => handle.walkToward(cmd.target, cmd.yards, abort), json),
  whisper: (cmd, { handle, socket }) => {
    handle.sendWhisper(cmd.target, cmd.message);
    return acknowledge(socket);
  },
  who: async (cmd, { handle, socket }) => {
    const results = await handle.who(whoQuery(cmd.filter));
    return send(socket, formatWhoResults(results).split("\n"));
  },
  who_json: async (cmd, { handle, socket }) => {
    const results = await handle.who(whoQuery(cmd.filter));
    return send(socket, [formatWhoResultsJson(results)]);
  },
  yell: (cmd, { handle, socket }) => {
    handle.sendYell(cmd.message);
    return acknowledge(socket);
  },
};

function runHandler<K extends IpcCommand["type"]>(
  cmd: Extract<IpcCommand, { type: K }>,
  ctx: DispatchContext,
): boolean | Promise<boolean> {
  const handler: Handler<K> = HANDLERS[cmd.type];
  return handler(cmd, ctx);
}

export async function dispatchCommand(
  cmd: IpcCommand,
  ctx: DispatchContext,
): Promise<boolean> {
  return await runHandler(cmd, ctx);
}

const ok = (): string[] => ["OK"];
const json = (value: unknown): string[] => [JSON.stringify(jsonSafe(value))];
const pretty = (value: unknown): string[] =>
  JSON.stringify(jsonSafe(value), null, 2).split("\n");
const controlText = (state: ControlState): string[] =>
  formatControlState(state).split("\n");
const controlJson = (state: ControlState): string[] => [
  JSON.stringify(formatControlStateObj(state)),
];

async function reply<T>(
  socket: IpcSocket,
  run: () => T | Promise<T>,
  format: (value: T) => string[],
): Promise<false> {
  try {
    writeLines(socket, format(await run()));
  } catch (error) {
    writeLines(socket, [`ERR ${messageOf(error, "internal")}`]);
  }
  return false;
}

function navigationObservation(handle: WorldHandle) {
  const state = handle.getNavigationState();
  return { ...state, nextStep: nextStepFor(state.blockedReason) };
}
