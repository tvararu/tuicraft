import { createInterface } from "node:readline";
import { ChatType } from "protocol/opcodes";
import type { WorldHandle, ChatMessage } from "client";

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

function formatMessage(msg: ChatMessage, interactive: boolean): string {
  if (!interactive) {
    const label =
      CHAT_TYPE_LABELS[msg.type]?.toUpperCase().replace(/ /g, "_") ??
      `TYPE_${msg.type}`;
    return `${label}\t${msg.sender}\t${msg.message}`;
  }

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

export function startTui(
  handle: WorldHandle,
  interactive: boolean,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let lastWhisperFrom: string | undefined;

    handle.onMessage((msg) => {
      if (msg.type === ChatType.WHISPER) {
        lastWhisperFrom = msg.sender;
      }

      const line = formatMessage(msg, interactive);

      if (interactive) {
        process.stdout.write(`\r\x1b[K${line}\n`);
        rl.prompt(true);
      } else {
        process.stdout.write(line + "\n");
      }
    });

    const rl = createInterface({
      input: process.stdin,
      output: interactive ? process.stdout : undefined,
      prompt: interactive ? "> " : "",
      terminal: interactive,
    });

    if (interactive) rl.prompt();

    rl.on("line", async (input) => {
      const cmd = parseCommand(input.trim());

      switch (cmd.type) {
        case "say":
          handle.sendSay(cmd.message);
          break;
        case "yell":
          handle.sendYell(cmd.message);
          break;
        case "guild":
          handle.sendGuild(cmd.message);
          break;
        case "party":
          handle.sendParty(cmd.message);
          break;
        case "raid":
          handle.sendRaid(cmd.message);
          break;
        case "whisper":
          handle.sendWhisper(cmd.target, cmd.message);
          lastWhisperFrom = cmd.target;
          break;
        case "reply":
          if (!lastWhisperFrom) {
            const errLine = interactive
              ? "[system] No one has whispered you yet."
              : "SYSTEM\t\tNo one has whispered you yet.";
            process.stdout.write(errLine + "\n");
          } else {
            handle.sendWhisper(lastWhisperFrom, cmd.message);
          }
          break;
        case "channel": {
          const channel = /^\d+$/.test(cmd.target)
            ? handle.getChannel(parseInt(cmd.target, 10))
            : cmd.target;
          if (!channel) {
            const errLine = interactive
              ? `[system] Not in channel ${cmd.target}.`
              : `SYSTEM\t\tNot in channel ${cmd.target}.`;
            process.stdout.write(errLine + "\n");
          } else {
            handle.sendChannel(channel, cmd.message);
          }
          break;
        }
        case "who": {
          const results = await handle.who(
            cmd.target ? { name: cmd.target } : {},
          );
          const line = interactive
            ? `[who] ${results.length} results: ${results.map((r) => `${r.name} (${r.level})`).join(", ") || "none"}`
            : results
                .map((r) => `WHO\t${r.name}\t${r.level}\t${r.guild}`)
                .join("\n") || "WHO\t\t0\t";
          process.stdout.write(line + "\n");
          break;
        }
        case "quit":
          handle.close();
          rl.close();
          resolve();
          return;
      }

      if (interactive) rl.prompt();
    });

    rl.on("close", () => {
      resolve();
    });

    handle.closed.then(() => {
      rl.close();
    });
  });
}
