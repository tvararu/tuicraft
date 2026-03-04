import { createInterface } from "node:readline";
import { ChatType } from "wow/protocol/opcodes";
import type { WorldHandle } from "wow/client";
import { parseCommand, type Command } from "ui/commands";
import {
  formatMessage,
  formatError,
  formatWhoResults,
  formatPrompt,
  formatGroupEvent,
  formatEntityEvent,
  formatFriendList,
  formatIgnoreList,
  formatGuildRoster,
  formatMailList,
  formatMailRead,
  resolveMailSender,
} from "ui/format";

export type TuiState = {
  handle: WorldHandle;
  write: (s: string) => void;
  lastWhisperFrom: string | undefined;
  showEntityEvents: boolean;
};

export async function executeCommand(
  state: TuiState,
  cmd: Command,
): Promise<boolean> {
  switch (cmd.type) {
    case "chat":
      state.handle.sendInCurrentMode(cmd.message);
      break;
    case "say":
      state.handle.sendSay(cmd.message);
      break;
    case "yell":
      state.handle.sendYell(cmd.message);
      break;
    case "guild":
      state.handle.sendGuild(cmd.message);
      break;
    case "party":
      state.handle.sendParty(cmd.message);
      break;
    case "raid":
      state.handle.sendRaid(cmd.message);
      break;
    case "emote":
      state.handle.sendEmote(cmd.message);
      break;
    case "dnd":
      state.handle.sendDnd(cmd.message);
      break;
    case "afk":
      state.handle.sendAfk(cmd.message);
      break;
    case "whisper":
      state.handle.sendWhisper(cmd.target, cmd.message);
      state.lastWhisperFrom = cmd.target;
      break;
    case "reply":
      if (!state.lastWhisperFrom) {
        state.write(formatError("No one has whispered you yet.") + "\n");
      } else {
        state.handle.sendWhisper(state.lastWhisperFrom, cmd.message);
      }
      break;
    case "channel": {
      const channel = /^\d+$/.test(cmd.target)
        ? state.handle.getChannel(parseInt(cmd.target, 10))
        : cmd.target;
      if (!channel) {
        state.write(formatError(`Not in channel ${cmd.target}.`) + "\n");
      } else {
        state.handle.sendChannel(channel, cmd.message);
      }
      break;
    }
    case "who": {
      const results = await state.handle.who(
        cmd.target ? { name: cmd.target } : {},
      );
      state.write(formatWhoResults(results) + "\n");
      break;
    }
    case "invite":
      state.handle.invite(cmd.target);
      break;
    case "kick":
      state.handle.uninvite(cmd.target);
      break;
    case "leave":
      state.handle.leaveGroup();
      break;
    case "join-channel":
      state.handle.joinChannel(cmd.channel, cmd.password);
      break;
    case "leave-channel":
      state.handle.leaveChannel(cmd.channel);
      break;
    case "leader":
      state.handle.setLeader(cmd.target);
      break;
    case "accept":
      state.handle.acceptInvite();
      break;
    case "decline":
      state.handle.declineInvite();
      break;
    case "quit":
      return true;
    case "tuicraft":
      if (cmd.subcommand === "entities") {
        if (cmd.value === "on") {
          state.showEntityEvents = true;
          state.write("[system] Entity events enabled\n");
        } else if (cmd.value === "off") {
          state.showEntityEvents = false;
          state.write("[system] Entity events disabled\n");
        } else {
          state.write("[system] Usage: /tuicraft entities on|off\n");
        }
      } else {
        state.write(`[system] Unknown tuicraft command: ${cmd.subcommand}\n`);
      }
      break;
    case "friends": {
      const friends = state.handle.getFriends();
      state.write(formatFriendList(friends) + "\n");
      break;
    }
    case "add-friend":
      state.handle.addFriend(cmd.target);
      break;
    case "remove-friend":
      state.handle.removeFriend(cmd.target);
      break;
    case "ignored": {
      const ignored = state.handle.getIgnored();
      state.write(formatIgnoreList(ignored) + "\n");
      break;
    }
    case "add-ignore":
      state.handle.addIgnore(cmd.target);
      break;
    case "remove-ignore":
      state.handle.removeIgnore(cmd.target);
      break;
    case "guild-roster": {
      const roster = await state.handle.requestGuildRoster();
      if (roster) {
        state.write(formatGuildRoster(roster) + "\n");
      } else {
        state.write("[guild] No guild roster available\n");
      }
      break;
    }
    case "roll":
      state.handle.sendRoll(cmd.min, cmd.max);
      break;
    case "guild-invite":
      state.handle.guildInvite(cmd.target);
      break;
    case "guild-kick":
      state.handle.guildRemove(cmd.target);
      break;
    case "guild-leave":
      state.handle.guildLeave();
      break;
    case "guild-promote":
      state.handle.guildPromote(cmd.target);
      break;
    case "guild-demote":
      state.handle.guildDemote(cmd.target);
      break;
    case "guild-leader":
      state.handle.guildLeader(cmd.target);
      break;
    case "guild-motd":
      state.handle.guildMotd(cmd.message);
      break;
    case "guild-accept":
      state.handle.acceptGuildInvite();
      break;
    case "guild-decline":
      state.handle.declineGuildInvite();
      break;
    case "mail-list": {
      if (!state.handle.getMailboxGuid()) {
        state.write(
          formatError("No mailbox open. Interact with a mailbox first.") + "\n",
        );
        break;
      }
      const entries = await state.handle.requestMailList();
      state.write(formatMailList(entries, state.handle.getNameCache()) + "\n");
      break;
    }
    case "mail-read": {
      if (!state.handle.getMailboxGuid()) {
        state.write(
          formatError("No mailbox open. Interact with a mailbox first.") + "\n",
        );
        break;
      }
      const cache = state.handle.getMailCache();
      const entry = cache[cmd.index - 1];
      if (!entry) {
        state.write(
          formatError(`No mail #${cmd.index}. Use /mail to list your inbox.`) +
            "\n",
        );
        break;
      }
      const sender = resolveMailSender(entry, state.handle.getNameCache());
      state.handle.markMailAsRead(entry.messageId);
      state.write(formatMailRead(entry, sender) + "\n");
      break;
    }
    case "mail-send": {
      if (!state.handle.getMailboxGuid()) {
        state.write(
          formatError("No mailbox open. Interact with a mailbox first.") + "\n",
        );
        break;
      }
      state.handle.sendMail(cmd.target, cmd.subject, cmd.body);
      break;
    }
    case "mail-delete": {
      if (!state.handle.getMailboxGuid()) {
        state.write(
          formatError("No mailbox open. Interact with a mailbox first.") + "\n",
        );
        break;
      }
      const delCache = state.handle.getMailCache();
      const delEntry = delCache[cmd.index - 1];
      if (!delEntry) {
        state.write(
          formatError(`No mail #${cmd.index}. Use /mail to list your inbox.`) +
            "\n",
        );
        break;
      }
      state.handle.deleteMail(delEntry.messageId);
      state.write(`[mail] Mail #${cmd.index} deleted.\n`);
      break;
    }
  }
  return false;
}

export type TuiOptions = {
  input?: NodeJS.ReadableStream;
  write?: (s: string) => void;
};

export function startTui(
  handle: WorldHandle,
  interactive: boolean,
  opts: TuiOptions = {},
): Promise<void> {
  const write = opts.write ?? ((s: string) => void process.stdout.write(s));
  const state: TuiState = {
    handle,
    write,
    lastWhisperFrom: undefined,
    showEntityEvents: false,
  };

  return new Promise<void>((resolve) => {
    handle.onMessage((msg) => {
      if (msg.type === ChatType.WHISPER) state.lastWhisperFrom = msg.sender;
      const line = formatMessage(msg);
      write(interactive ? `\r\x1b[K${line}\n` : line + "\n");
      if (interactive) rl.prompt(true);
    });

    handle.onGroupEvent((event) => {
      const line = formatGroupEvent(event);
      if (!line) return;
      write(interactive ? `\r\x1b[K${line}\n` : line + "\n");
      if (interactive) rl.prompt(true);
    });

    handle.onEntityEvent((event) => {
      if (!state.showEntityEvents) return;
      const line = formatEntityEvent(event);
      if (!line) return;
      write(interactive ? `\r\x1b[K${line}\n` : line + "\n");
      if (interactive) rl.prompt(true);
    });

    const rl = createInterface({
      input: opts.input ?? process.stdin,
      output: interactive ? process.stdout : undefined,
      prompt: interactive ? formatPrompt(handle.getLastChatMode()) : "",
      terminal: interactive,
    });

    if (interactive) rl.prompt();

    rl.on("line", async (input) => {
      try {
        if (await executeCommand(state, parseCommand(input.trim()))) {
          handle.close();
          rl.close();
          resolve();
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        write(formatError(msg) + "\n");
      }
      if (interactive) {
        rl.setPrompt(formatPrompt(handle.getLastChatMode()));
        rl.prompt();
      }
    });

    rl.on("SIGINT", () => {
      handle.close();
      rl.close();
    });

    rl.on("close", () => {
      handle.close();
      resolve();
    });

    handle.closed.then(() => rl.close());
  });
}
