import { createInterface, type Interface } from "node:readline";
import { ChatType, type WorldHandle } from "@tuicraft/core";
import { type Command, parseCommand } from "#ui/commands";
import {
  formatEntityEvent,
  formatError,
  formatFriendList,
  formatGuildRoster,
  formatIgnoreList,
  formatPrompt,
  formatWhoResults,
} from "#ui/format";
import { formatMessage } from "#ui/format-chat";
import { formatGroupEvent } from "#ui/format-group";

export type TuiState = {
  handle: WorldHandle;
  write: (s: string) => void;
  lastWhisperFrom: string | undefined;
  showEntityEvents: boolean;
};

const CHANNEL_NUMBER = /^\d+$/;

type TuiCommand = Exclude<Command, { type: "quit" }>;

type TuiHandler<K extends TuiCommand["type"]> = (
  cmd: Extract<TuiCommand, { type: K }>,
  state: TuiState,
) => Promise<void> | undefined;

type TuiHandlers = {
  [K in TuiCommand["type"]]: TuiHandler<K>;
};

function replyToLastWhisper(state: TuiState, message: string): void {
  if (state.lastWhisperFrom) {
    state.handle.sendWhisper(state.lastWhisperFrom, message);
  } else {
    state.write(`${formatError("No one has whispered you yet.")}\n`);
  }
}

function sendToChannel(state: TuiState, target: string, message: string) {
  const channel = CHANNEL_NUMBER.test(target)
    ? state.handle.getChannel(Number.parseInt(target, 10))
    : target;
  if (channel) {
    state.handle.sendChannel(channel, message);
  } else {
    state.write(`${formatError(`Not in channel ${target}.`)}\n`);
  }
}

function runTuicraft(state: TuiState, subcommand: string, value: string) {
  if (subcommand !== "entities") {
    state.write(`[system] Unknown tuicraft command: ${subcommand}\n`);
    return;
  }
  if (value === "on") {
    state.showEntityEvents = true;
    state.write("[system] Entity events enabled\n");
  } else if (value === "off") {
    state.showEntityEvents = false;
    state.write("[system] Entity events disabled\n");
  } else {
    state.write("[system] Usage: /tuicraft entities on|off\n");
  }
}

async function showWho(state: TuiState, target: string | undefined) {
  const results = await state.handle.who(target ? { name: target } : {});
  state.write(`${formatWhoResults(results)}\n`);
}

async function showGuildRoster(state: TuiState) {
  const roster = await state.handle.requestGuildRoster();
  if (roster) {
    state.write(`${formatGuildRoster(roster)}\n`);
  } else {
    state.write("[guild] No guild roster available\n");
  }
}

const TUI_HANDLERS: TuiHandlers = {
  accept: (_cmd, { handle }) => {
    handle.acceptInvite();
  },
  "add-friend": (cmd, { handle }) => {
    handle.addFriend(cmd.target);
  },
  "add-ignore": (cmd, { handle }) => {
    handle.addIgnore(cmd.target);
  },
  afk: (cmd, { handle }) => {
    handle.sendAfk(cmd.message);
  },
  channel: (cmd, state) => {
    sendToChannel(state, cmd.target, cmd.message);
  },
  chat: (cmd, { handle }) => {
    handle.sendInCurrentMode(cmd.message);
  },
  decline: (_cmd, { handle }) => {
    handle.declineInvite();
  },
  dnd: (cmd, { handle }) => {
    handle.sendDnd(cmd.message);
  },
  emote: (cmd, { handle }) => {
    handle.sendEmote(cmd.message);
  },
  friends: (_cmd, state) => {
    state.write(`${formatFriendList(state.handle.getFriends())}\n`);
  },
  guild: (cmd, { handle }) => {
    handle.sendGuild(cmd.message);
  },
  "guild-accept": (_cmd, { handle }) => {
    handle.acceptGuildInvite();
  },
  "guild-decline": (_cmd, { handle }) => {
    handle.declineGuildInvite();
  },
  "guild-demote": (cmd, { handle }) => {
    handle.guildDemote(cmd.target);
  },
  "guild-invite": (cmd, { handle }) => {
    handle.guildInvite(cmd.target);
  },
  "guild-kick": (cmd, { handle }) => {
    handle.guildRemove(cmd.target);
  },
  "guild-leader": (cmd, { handle }) => {
    handle.guildLeader(cmd.target);
  },
  "guild-leave": (_cmd, { handle }) => {
    handle.guildLeave();
  },
  "guild-motd": (cmd, { handle }) => {
    handle.guildMotd(cmd.message);
  },
  "guild-promote": (cmd, { handle }) => {
    handle.guildPromote(cmd.target);
  },
  "guild-roster": (_cmd, state) => showGuildRoster(state),
  ignored: (_cmd, state) => {
    state.write(`${formatIgnoreList(state.handle.getIgnored())}\n`);
  },
  invite: (cmd, { handle }) => {
    handle.invite(cmd.target);
  },
  "join-channel": (cmd, { handle }) => {
    handle.joinChannel(cmd.channel, cmd.password);
  },
  kick: (cmd, { handle }) => {
    handle.uninvite(cmd.target);
  },
  leader: (cmd, { handle }) => {
    handle.setLeader(cmd.target);
  },
  leave: (_cmd, { handle }) => {
    handle.leaveGroup();
  },
  "leave-channel": (cmd, { handle }) => {
    handle.leaveChannel(cmd.channel);
  },
  party: (cmd, { handle }) => {
    handle.sendParty(cmd.message);
  },
  raid: (cmd, { handle }) => {
    handle.sendRaid(cmd.message);
  },
  "remove-friend": (cmd, { handle }) => {
    handle.removeFriend(cmd.target);
  },
  "remove-ignore": (cmd, { handle }) => {
    handle.removeIgnore(cmd.target);
  },
  reply: (cmd, state) => {
    replyToLastWhisper(state, cmd.message);
  },
  roll: (cmd, { handle }) => {
    handle.sendRoll(cmd.min, cmd.max);
  },
  say: (cmd, { handle }) => {
    handle.sendSay(cmd.message);
  },
  tuicraft: (cmd, state) => {
    runTuicraft(state, cmd.subcommand, cmd.value);
  },
  unimplemented: (cmd, state) => {
    state.write(`${formatError(`${cmd.feature} is not yet implemented`)}\n`);
  },
  whisper: (cmd, state) => {
    state.handle.sendWhisper(cmd.target, cmd.message);
    state.lastWhisperFrom = cmd.target;
  },
  who: (cmd, state) => showWho(state, cmd.target),
  yell: (cmd, { handle }) => {
    handle.sendYell(cmd.message);
  },
};

function runTuiHandler<K extends TuiCommand["type"]>(
  cmd: Extract<TuiCommand, { type: K }>,
  state: TuiState,
): Promise<void> | undefined {
  const handler: TuiHandler<K> = TUI_HANDLERS[cmd.type];
  return handler(cmd, state);
}

async function executeCommand(state: TuiState, cmd: Command): Promise<boolean> {
  if (cmd.type === "quit") return true;
  const pending = runTuiHandler(cmd, state);
  if (pending) await pending;
  return false;
}

export type TuiOptions = {
  input?: NodeJS.ReadableStream;
  write?: (s: string) => void;
};

function subscribeEvents(state: TuiState, echo: (line: string) => void) {
  const { handle } = state;
  handle.onMessage((msg) => {
    if (msg.type === ChatType.WHISPER) state.lastWhisperFrom = msg.sender;
    echo(formatMessage(msg));
  });

  handle.onGroupEvent((event) => {
    const line = formatGroupEvent(event);
    if (!line) return;
    echo(line);
  });

  handle.onEntityEvent((event) => {
    if (!state.showEntityEvents) return;
    const line = formatEntityEvent(event);
    if (!line) return;
    echo(line);
  });
}

type LineContext = {
  state: TuiState;
  rl: Interface;
  interactive: boolean;
  resolve: () => void;
};

async function handleLine(input: string, ctx: LineContext): Promise<void> {
  const { state, rl, interactive, resolve } = ctx;
  const { handle } = state;
  try {
    if (await executeCommand(state, parseCommand(input.trim()))) {
      handle.logout();
      rl.close();
      resolve();
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.write(`${formatError(msg)}\n`);
  }
  if (interactive) {
    rl.setPrompt(formatPrompt(handle.getLastChatMode()));
    rl.prompt();
  }
}

export function startTui(
  handle: WorldHandle,
  interactive: boolean,
  opts: TuiOptions = {},
): Promise<void> {
  const write = opts.write ?? ((s: string) => void process.stdout.write(s));
  const state: TuiState = {
    handle,
    lastWhisperFrom: undefined,
    showEntityEvents: false,
    write,
  };

  return new Promise<void>((resolve) => {
    subscribeEvents(state, (line) => {
      write(interactive ? `\r\x1b[K${line}\n` : `${line}\n`);
      if (interactive) rl.prompt(true);
    });

    const rl = createInterface({
      input: opts.input ?? process.stdin,
      output: interactive ? process.stdout : undefined,
      prompt: interactive ? formatPrompt(handle.getLastChatMode()) : "",
      terminal: interactive,
    });

    if (interactive) rl.prompt();

    rl.on("line", (input) =>
      handleLine(input, { interactive, resolve, rl, state }),
    );

    rl.on("SIGINT", () => {
      handle.logout();
      rl.close();
    });

    rl.on("close", () => {
      handle.logout();
      resolve();
    });

    handle.closed.then(() => rl.close());
  });
}
