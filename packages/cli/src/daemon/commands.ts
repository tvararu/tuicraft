import type { ChatMode, ControlState, WorldHandle } from "@tuicraft/core";
import { messageOf } from "@tuicraft/core/lib/errors";
import {
  type IpcSocket,
  readWait,
  tailWait,
  writeLines,
} from "#daemon/event-wait";
import { formatNearbyLine, formatNearbyObj } from "#daemon/nearby";
import type { IpcCommand } from "#daemon/parse";
import type { RingBuffer } from "#lib/ring-buffer";
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
} from "#ui/format";
import {
  formatCombatState,
  formatFightOutcome,
  formatTacticsState,
} from "#ui/format-combat";
import { formatControlState, formatControlStateObj } from "#ui/format-control";
import {
  formatCycleState,
  formatDefenseState,
  formatDestroyState,
  formatExperienceState,
  formatInventoryState,
  formatRecoveryState,
  formatRewardsState,
} from "#ui/format-gameplay";
import { formatPartyState } from "#ui/format-party";
import { formatQuestState } from "#ui/format-quests";
import { formatTrainerState } from "#ui/format-trainer";
import { formatVendorState } from "#ui/format-vendor";

export type EventEntry = { text: string | undefined; json: string };

type EventFormat = (entries: EventEntry[]) => string[];

const asText: EventFormat = (entries) =>
  entries.flatMap((e) => (e.text === undefined ? [] : [e.text]));

const asJson: EventFormat = (entries) => entries.map((e) => e.json);

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
  buy: (cmd, { handle, socket }) =>
    reply(socket, () => handle.buyItem(cmd.slot, cmd.count), ok),
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
    reply(socket, () => handle.getCombatState(), formatCombatState),
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
      () =>
        cmd.questId === undefined
          ? handle.startCycle(cmd.guids, cmd.instruction, cmd.maxStarts)
          : handle.startQuestCycle(
              cmd.questId,
              cmd.sources ?? [],
              cmd.instruction,
              cmd.maxStarts,
            ),
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
  defend: (cmd, { handle, socket }) =>
    reply(
      socket,
      () =>
        cmd.enabled
          ? handle.armDefense(cmd.instruction ?? "")
          : handle.disarmDefense(),
      ok,
    ),
  defense: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getDefenseState(), formatDefenseState),
  defense_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getDefenseState(), json),
  del_friend: (cmd, { handle, socket }) => {
    handle.removeFriend(cmd.target);
    return acknowledge(socket);
  },
  del_ignore: (cmd, { handle, socket }) => {
    handle.removeIgnore(cmd.target);
    return acknowledge(socket);
  },
  destroy: (cmd, { handle, socket }) =>
    reply(socket, () => handle.destroyItem(cmd.bag, cmd.slot, cmd.count), ok),
  dnd: (cmd, { handle, socket }) => {
    handle.sendDnd(cmd.message);
    return acknowledge(socket);
  },
  emote: (cmd, { handle, socket }) => {
    handle.sendEmote(cmd.message);
    return acknowledge(socket);
  },
  event_mark: (_cmd, { events, socket }) =>
    send(socket, [String(events.writePos)]),
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
      async () => {
        const run = handle.startTactics(
          cmd.guid,
          cmd.instruction,
          abort,
          cmd.framing,
        );
        const { runId } = handle.getTacticsState();
        await run;
        return { runId, state: handle.getTacticsState() };
      },
      ({ runId, state }) => [`OK ${formatFightOutcome(state, runId)}`],
    ),
  friends: (_cmd, { handle, socket }) =>
    send(socket, formatFriendList(handle.getFriends()).split("\n")),
  friends_json: (_cmd, { handle, socket }) =>
    send(socket, [formatFriendListJson(handle.getFriends())]),
  goto: (cmd, { handle, socket }) =>
    reply(socket, () => handle.goTo(cmd.target), ok),
  group: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getPartyState(), formatPartyState),
  group_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getPartyState(), json),
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
    reply(
      socket,
      () => handle,
      (h) => [
        ...formatInventoryState(h.getInventoryState()),
        ...formatDestroyState(h.getDestroyState()),
      ],
    ),
  inventory_json: (_cmd, { handle, socket }) =>
    reply(
      socket,
      () => ({
        ...handle.getInventoryState(),
        destroy: handle.getDestroyState(),
      }),
      json,
    ),
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
  loot_roll: (cmd, { handle, socket }) =>
    reply(socket, () => handle.rollLoot(cmd.guid, cmd.slot, cmd.vote), ok),
  move: (cmd, { handle, socket }) =>
    reply(socket, () => handle.move(cmd.direction, cmd.durationMs), ok),
  navigation: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.observeNavigation(), pretty),
  navigation_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.observeNavigation(), json),
  nearby: (cmd, { handle, socket }) =>
    send(socket, handle.queryNearby({ all: cmd.all }).map(formatNearbyLine)),
  nearby_json: (cmd, { handle, socket }) =>
    send(
      socket,
      handle
        .queryNearby({ all: cmd.all })
        .map((p) => JSON.stringify(formatNearbyObj(p))),
    ),
  open_loot: (cmd, { handle, socket }) =>
    reply(socket, () => handle.openLoot(cmd.guid), ok),
  open_trainer: (cmd, { handle, socket }) =>
    reply(socket, () => handle.openTrainer(cmd.guid), ok),
  open_vendor: (cmd, { handle, socket }) =>
    reply(socket, () => handle.openVendor(cmd.guid), ok),
  party: (cmd, { handle, socket }) => {
    handle.sendParty(cmd.message);
    return acknowledge(socket);
  },
  query_corpse: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.queryCorpse(), ok),
  query_quest: (cmd, { handle, socket }) =>
    reply(socket, () => handle.queryQuest(cmd.questId), ok),
  quests: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getQuestState(), formatQuestState),
  quests_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getQuestState(), json),
  read: (_cmd, { events, socket }) => send(socket, asText(events.drain())),
  read_json: (_cmd, { events, socket }) => send(socket, asJson(events.drain())),
  read_wait: (cmd, ctx) => readWait(ctx, cmd, asText),
  read_wait_json: (cmd, ctx) => readWait(ctx, cmd, asJson),
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
  repair: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.repairAll(), ok),
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
  sell: (cmd, { handle, socket }) =>
    reply(socket, () => handle.sellItem(cmd.bag, cmd.slot, cmd.count), ok),
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
    reply(socket, () => handle.getTacticsState(), formatTacticsState),
  tactics_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getTacticsState(), json),
  tail_wait: (cmd, ctx) => tailWait(ctx, cmd.ms, asText),
  tail_wait_json: (cmd, ctx) => tailWait(ctx, cmd.ms, asJson),
  take_loot: (cmd, { handle, socket }) =>
    reply(socket, () => handle.takeLoot(cmd.slot), ok),
  take_money: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.takeLootMoney(), ok),
  talk: (cmd, { handle, socket }) =>
    reply(socket, () => handle.talk(cmd.guid), ok),
  target: (cmd, { handle, socket }) =>
    reply(socket, () => handle.selectTarget(cmd.guid), ok),
  train: (cmd, { handle, socket }) =>
    reply(socket, () => handle.trainSpell(cmd.spellId), ok),
  trainer: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getTrainerState(), formatTrainerState),
  trainer_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getTrainerState(), json),
  unimplemented: (cmd, { socket }) =>
    send(socket, [`UNIMPLEMENTED ${cmd.feature}`]),
  use: (cmd, { handle, socket }) =>
    reply(socket, () => handle.useItem(cmd.bag, cmd.slot), ok),
  vendor: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getVendorState(), formatVendorState),
  vendor_json: (_cmd, { handle, socket }) =>
    reply(socket, () => handle.getVendorState(), json),
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
