import type { RingBuffer } from "lib/ring-buffer";
import { messageOf } from "lib/errors";
import type { IpcCommand } from "daemon/parse";
import {
  prepareNearbyEntities,
  formatNearbyLine,
  formatNearbyObj,
} from "daemon/nearby";
import {
  formatWhoResults,
  formatWhoResultsJson,
  formatFriendList,
  formatFriendListJson,
  formatIgnoreList,
  formatIgnoreListJson,
  formatGuildRoster,
  formatGuildRosterJson,
  jsonSafe,
} from "ui/format";
import {
  formatControlState,
  formatControlStateObj,
  nextStepFor,
} from "ui/format-control";
import type { WorldHandle } from "wow/client";
import type { ControlState } from "wow/control";

export type EventEntry = { text: string | undefined; json: string };

export type IpcSocket = {
  write(data: string | Uint8Array): number;
  end(): void;
};

export function writeLines(socket: IpcSocket, lines: string[]): void {
  for (const line of lines) socket.write(line + "\n");
  socket.write("\n");
}

function drainText(events: RingBuffer<EventEntry>): string[] {
  return events.drain().flatMap((e) => (e.text !== undefined ? [e.text] : []));
}

function drainJson(events: RingBuffer<EventEntry>): string[] {
  return events.drain().map((e) => e.json);
}

function sliceText(events: RingBuffer<EventEntry>, from: number): string[] {
  return events
    .slice(from)
    .flatMap((e) => (e.text !== undefined ? [e.text] : []));
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

export async function dispatchCommand(
  cmd: IpcCommand,
  handle: WorldHandle,
  events: RingBuffer<EventEntry>,
  socket: IpcSocket,
  cleanup: () => void,
  abort?: AbortSignal,
): Promise<boolean> {
  switch (cmd.type) {
    case "chat": {
      handle.sendInCurrentMode(cmd.message);
      const mode = handle.getLastChatMode();
      const label =
        mode.type === "whisper"
          ? `WHISPER ${mode.target}`
          : mode.type === "channel"
            ? `CHANNEL ${mode.channel}`
            : mode.type.toUpperCase();
      writeLines(socket, [`OK ${label}`]);
      return false;
    }
    case "say":
      handle.sendSay(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "yell":
      handle.sendYell(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "guild":
      handle.sendGuild(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "party":
      handle.sendParty(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "emote":
      handle.sendEmote(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "dnd":
      handle.sendDnd(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "afk":
      handle.sendAfk(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "whisper":
      handle.sendWhisper(cmd.target, cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "roll":
      handle.sendRoll(cmd.min, cmd.max);
      writeLines(socket, ["OK"]);
      return false;
    case "read":
      writeLines(socket, drainText(events));
      return false;
    case "read_json":
      writeLines(socket, drainJson(events));
      return false;
    case "read_wait": {
      const start = events.writePos;
      const aborted = await waitUnlessAborted(cmd.ms, abort);
      if (aborted) return false;
      writeLines(socket, sliceText(events, start));
      return false;
    }
    case "read_wait_json": {
      const start = events.writePos;
      const aborted = await waitUnlessAborted(cmd.ms, abort);
      if (aborted) return false;
      writeLines(socket, sliceJson(events, start));
      return false;
    }
    case "stop":
      writeLines(socket, ["OK"]);
      cleanup();
      return true;
    case "status":
      writeLines(socket, ["CONNECTED"]);
      return false;
    case "who": {
      const results = await handle.who(cmd.filter ? { name: cmd.filter } : {});
      writeLines(socket, formatWhoResults(results).split("\n"));
      return false;
    }
    case "who_json": {
      const results = await handle.who(cmd.filter ? { name: cmd.filter } : {});
      writeLines(socket, [formatWhoResultsJson(results)]);
      return false;
    }
    case "invite":
      handle.invite(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "kick":
      handle.uninvite(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "leave":
      handle.leaveGroup();
      writeLines(socket, ["OK"]);
      return false;
    case "leader":
      handle.setLeader(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "accept":
      handle.acceptInvite();
      writeLines(socket, ["OK"]);
      return false;
    case "decline":
      handle.declineInvite();
      writeLines(socket, ["OK"]);
      return false;
    case "nearby": {
      const items = prepareNearbyEntities(handle, cmd.all);
      writeLines(socket, items.map(formatNearbyLine));
      return false;
    }
    case "nearby_json": {
      const items = prepareNearbyEntities(handle, cmd.all);
      writeLines(
        socket,
        items.map((p) => JSON.stringify(formatNearbyObj(p))),
      );
      return false;
    }
    case "friends": {
      const friends = handle.getFriends();
      writeLines(socket, formatFriendList(friends).split("\n"));
      return false;
    }
    case "friends_json": {
      const friends = handle.getFriends();
      writeLines(socket, [formatFriendListJson(friends)]);
      return false;
    }
    case "add_friend":
      handle.addFriend(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "del_friend":
      handle.removeFriend(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "ignored": {
      const ignored = handle.getIgnored();
      writeLines(socket, formatIgnoreList(ignored).split("\n"));
      return false;
    }
    case "ignored_json": {
      const ignored = handle.getIgnored();
      writeLines(socket, [formatIgnoreListJson(ignored)]);
      return false;
    }
    case "add_ignore":
      handle.addIgnore(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "del_ignore":
      handle.removeIgnore(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "join_channel":
      handle.joinChannel(cmd.channel, cmd.password);
      writeLines(socket, ["OK"]);
      return false;
    case "leave_channel":
      handle.leaveChannel(cmd.channel);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_roster": {
      const roster = await handle.requestGuildRoster();
      if (roster) {
        writeLines(socket, formatGuildRoster(roster).split("\n"));
      } else {
        writeLines(socket, ["[guild] No guild roster available"]);
      }
      return false;
    }
    case "guild_roster_json": {
      const roster = await handle.requestGuildRoster();
      if (roster) {
        writeLines(socket, [formatGuildRosterJson(roster)]);
      } else {
        writeLines(socket, [
          JSON.stringify({ type: "GUILD_ROSTER", members: [] }),
        ]);
      }
      return false;
    }
    case "guild_invite":
      handle.guildInvite(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_kick":
      handle.guildRemove(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_leave":
      handle.guildLeave();
      writeLines(socket, ["OK"]);
      return false;
    case "guild_promote":
      handle.guildPromote(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_demote":
      handle.guildDemote(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_leader":
      handle.guildLeader(cmd.target);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_motd":
      handle.guildMotd(cmd.message);
      writeLines(socket, ["OK"]);
      return false;
    case "guild_accept":
      handle.acceptGuildInvite();
      writeLines(socket, ["OK"]);
      return false;
    case "guild_decline":
      handle.declineGuildInvite();
      writeLines(socket, ["OK"]);
      return false;
    case "control":
      return reply(socket, () => handle.getControlState(), controlText);
    case "control_json":
      return reply(socket, () => handle.getControlState(), controlJson);
    case "move":
      return reply(
        socket,
        () => handle.move(cmd.direction, cmd.durationMs),
        ok,
      );
    case "face":
      return reply(socket, () => handle.face(cmd.orientation), ok);
    case "face_guid":
      return reply(socket, () => handle.faceGuid(cmd.guid), ok);
    case "walk_toward":
      return reply(
        socket,
        () => handle.walkToward(cmd.target, cmd.yards, abort),
        json,
      );
    case "target":
      return reply(socket, () => handle.selectTarget(cmd.guid), ok);
    case "halt":
      return reply(socket, () => handle.halt(), ok);
    case "combat":
      return reply(socket, () => handle.getCombatState(), pretty);
    case "combat_json":
      return reply(socket, () => handle.getCombatState(), json);
    case "spells":
      return reply(socket, () => handle.getSpellbook(), pretty);
    case "spells_json":
      return reply(socket, () => handle.getSpellbook(), json);
    case "cast":
      return reply(socket, () => handle.cast(cmd.spellId, cmd.guid), ok);
    case "attack":
      return reply(socket, () => handle.attack(cmd.guid), ok);
    case "cancel_cast":
      return reply(socket, () => handle.cancelCast(), ok);
    case "stop_attack":
      return reply(socket, () => handle.stopAttack(), ok);
    case "fight":
      return reply(
        socket,
        () =>
          handle.startTactics(cmd.guid, cmd.instruction, abort, cmd.framing),
        ok,
      );
    case "tactics":
      return reply(socket, () => handle.getTacticsState(), pretty);
    case "tactics_json":
      return reply(socket, () => handle.getTacticsState(), json);
    case "cycle":
      return reply(
        socket,
        () => handle.startCycle(cmd.guids, cmd.instruction, cmd.maxStarts),
        ok,
      );
    case "cycling":
      return reply(socket, () => handle.getCycleState(), pretty);
    case "cycling_json":
      return reply(socket, () => handle.getCycleState(), json);
    case "goto":
      return reply(socket, () => handle.goTo(cmd.x, cmd.y, cmd.z), ok);
    case "navigation":
      return reply(socket, () => navigationObservation(handle), pretty);
    case "navigation_json":
      return reply(socket, () => navigationObservation(handle), json);
    case "recovery":
      return reply(socket, () => handle.getRecoveryState(), pretty);
    case "recovery_json":
      return reply(socket, () => handle.getRecoveryState(), json);
    case "query_corpse":
      return reply(socket, () => handle.queryCorpse(), ok);
    case "release_spirit":
      return reply(socket, () => handle.releaseSpirit(), ok);
    case "reclaim_corpse":
      return reply(socket, () => handle.reclaimCorpse(), ok);
    case "spirit_healer":
      return reply(socket, () => handle.activateSpiritHealer(cmd.guid), ok);
    case "resurrect":
      return reply(socket, () => handle.respondResurrection(cmd.accept), ok);
    case "quests":
      return reply(socket, () => handle.getQuestState(), pretty);
    case "quests_json":
      return reply(socket, () => handle.getQuestState(), json);
    case "talk":
      return reply(socket, () => handle.talk(cmd.guid), ok);
    case "query_quest":
      return reply(socket, () => handle.queryQuest(cmd.questId), ok);
    case "select_option":
      return reply(
        socket,
        () => handle.selectGossipOption(cmd.optionId, cmd.code),
        ok,
      );
    case "select_quest":
      return reply(socket, () => handle.selectQuest(cmd.questId), ok);
    case "accept_quest":
      return reply(socket, () => handle.acceptQuest(), ok);
    case "complete_quest":
      return reply(socket, () => handle.completeQuest(cmd.questId), ok);
    case "request_reward":
      return reply(socket, () => handle.requestQuestReward(), ok);
    case "choose_reward":
      return reply(socket, () => handle.chooseQuestReward(cmd.index), ok);
    case "abandon_quest":
      return reply(socket, () => handle.abandonQuest(cmd.slot), ok);
    case "cancel_interaction":
      return reply(socket, () => handle.cancelInteraction(), ok);
    case "inventory":
      return reply(socket, () => handle.getInventoryState(), pretty);
    case "inventory_json":
      return reply(socket, () => handle.getInventoryState(), json);
    case "loot":
      return reply(socket, () => handle.getRewardsState(), pretty);
    case "loot_json":
      return reply(socket, () => handle.getRewardsState(), json);
    case "open_loot":
      return reply(socket, () => handle.openLoot(cmd.guid), ok);
    case "take_loot":
      return reply(socket, () => handle.takeLoot(cmd.slot), ok);
    case "take_money":
      return reply(socket, () => handle.takeLootMoney(), ok);
    case "release_loot":
      return reply(socket, () => handle.releaseLoot(), ok);
    case "invalid":
      writeLines(socket, [`ERR ${cmd.reason}`]);
      return false;
    case "unimplemented":
      writeLines(socket, [`UNIMPLEMENTED ${cmd.feature}`]);
      return false;
  }
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
