import { createInterface } from "node:readline";
import { ChatType } from "protocol/opcodes";
import type { WorldHandle, ChatMessage, WhoResult } from "client";
import type { LogEntry } from "session-log";

export type Command =
  | { type: "say"; message: string }
  | { type: "yell"; message: string }
  | { type: "guild"; message: string }
  | { type: "party"; message: string }
  | { type: "raid"; message: string }
  | { type: "whisper"; target: string; message: string }
  | { type: "reply"; message: string }
  | { type: "channel"; target: string; message: string }
  | { type: "who"; target?: string }
  | { type: "quit" };

export function parseCommand(input: string): Command {
  if (!input.startsWith("/")) return { type: "say", message: input };

  const spaceIdx = input.indexOf(" ");
  const cmd = spaceIdx === -1 ? input : input.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1);

  switch (cmd) {
    case "/s":
    case "/say":
      return { type: "say", message: rest };
    case "/y":
    case "/yell":
      return { type: "yell", message: rest };
    case "/g":
    case "/guild":
      return { type: "guild", message: rest };
    case "/p":
    case "/party":
      return { type: "party", message: rest };
    case "/raid":
      return { type: "raid", message: rest };
    case "/w":
    case "/whisper": {
      const targetEnd = rest.indexOf(" ");
      if (targetEnd === -1)
        return { type: "whisper", target: rest, message: "" };
      return {
        type: "whisper",
        target: rest.slice(0, targetEnd),
        message: rest.slice(targetEnd + 1),
      };
    }
    case "/r":
      return { type: "reply", message: rest };
    case "/who":
      return rest ? { type: "who", target: rest } : { type: "who" };
    case "/quit":
      return { type: "quit" };
    default: {
      const channelMatch = cmd.match(/^\/(\d+)$/);
      if (channelMatch) {
        return { type: "channel", target: channelMatch[1]!, message: rest };
      }
      return { type: "say", message: input };
    }
  }
}

const CHAT_TYPE_LABELS: Record<number, string> = {
  [ChatType.SYSTEM]: "system",
  [ChatType.SAY]: "say",
  [ChatType.PARTY]: "party",
  [ChatType.RAID]: "raid",
  [ChatType.GUILD]: "guild",
  [ChatType.OFFICER]: "officer",
  [ChatType.YELL]: "yell",
  [ChatType.WHISPER]: "whisper from",
  [ChatType.WHISPER_INFORM]: "whisper to",
  [ChatType.EMOTE]: "emote",
  [ChatType.CHANNEL]: "channel",
  [ChatType.RAID_LEADER]: "raid leader",
  [ChatType.RAID_WARNING]: "raid warning",
  [ChatType.PARTY_LEADER]: "party leader",
};

export function formatMessage(msg: ChatMessage): string {
  const label = CHAT_TYPE_LABELS[msg.type] ?? `type ${msg.type}`;

  if (msg.type === ChatType.WHISPER) {
    return `[whisper from ${msg.sender}] ${msg.message}`;
  }
  if (msg.type === ChatType.WHISPER_INFORM) {
    return `[whisper to ${msg.sender}] ${msg.message}`;
  }
  if (msg.type === ChatType.SYSTEM) {
    return `[system] ${msg.message}`;
  }
  if (msg.type === ChatType.CHANNEL && msg.channel) {
    return `[${msg.channel}] ${msg.sender}: ${msg.message}`;
  }
  return `[${label}] ${msg.sender}: ${msg.message}`;
}

const JSON_TYPE_LABELS: Record<number, string> = {
  [ChatType.SYSTEM]: "SYSTEM",
  [ChatType.SAY]: "SAY",
  [ChatType.PARTY]: "PARTY",
  [ChatType.RAID]: "RAID",
  [ChatType.GUILD]: "GUILD",
  [ChatType.OFFICER]: "OFFICER",
  [ChatType.YELL]: "YELL",
  [ChatType.WHISPER]: "WHISPER_FROM",
  [ChatType.WHISPER_INFORM]: "WHISPER_TO",
  [ChatType.EMOTE]: "EMOTE",
  [ChatType.CHANNEL]: "CHANNEL",
  [ChatType.RAID_LEADER]: "RAID_LEADER",
  [ChatType.RAID_WARNING]: "RAID_WARNING",
  [ChatType.PARTY_LEADER]: "PARTY_LEADER",
};

export function formatMessageObj(msg: ChatMessage): LogEntry {
  const type = JSON_TYPE_LABELS[msg.type] ?? `TYPE_${msg.type}`;
  const obj: LogEntry = { type, sender: msg.sender, message: msg.message };
  if (msg.channel) obj.channel = msg.channel;
  return obj;
}

export function formatMessageJson(msg: ChatMessage): string {
  return JSON.stringify(formatMessageObj(msg));
}

export function formatError(message: string): string {
  return `[system] ${message}`;
}

export function formatWhoResults(results: WhoResult[]): string {
  const names =
    results.map((r) => `${r.name} (${r.level})`).join(", ") || "none";
  return `[who] ${results.length} results: ${names}`;
}

export function formatWhoResultsJson(results: WhoResult[]): string {
  return JSON.stringify({
    type: "WHO",
    count: results.length,
    results: results.map((r) => ({
      name: r.name,
      guild: r.guild,
      level: r.level,
      classId: r.classId,
      race: r.race,
      gender: r.gender,
      zone: r.zone,
    })),
  });
}

export type TuiState = {
  handle: WorldHandle;
  write: (s: string) => void;
  lastWhisperFrom: string | undefined;
};

export async function executeCommand(
  state: TuiState,
  cmd: Command,
): Promise<boolean> {
  switch (cmd.type) {
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
    case "quit":
      return true;
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
  };

  return new Promise<void>((resolve) => {
    handle.onMessage((msg) => {
      if (msg.type === ChatType.WHISPER) state.lastWhisperFrom = msg.sender;
      const line = formatMessage(msg);
      write(interactive ? `\r\x1b[K${line}\n` : line + "\n");
      if (interactive) rl.prompt(true);
    });

    const rl = createInterface({
      input: opts.input ?? process.stdin,
      output: interactive ? process.stdout : undefined,
      prompt: interactive ? "> " : "",
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
      if (interactive) rl.prompt();
    });

    rl.on("close", () => resolve());
    handle.closed.then(() => rl.close());
  });
}
