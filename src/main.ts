import {
  parseArgs,
  hasJsonOption,
  commandNameFromArgs,
  type CliAction,
} from "cli/args";
import { sendToSocket as sendRawToSocket, ensureDaemon } from "cli/ipc";
import {
  decodeReply,
  resultEnvelope,
  errorEnvelope,
  daemonCommandFailed,
  walkCommandFailed,
  formatHumanInspection,
  formatHumanIntent,
  type ReplyKind,
  type OutputEnvelope,
  type OutputStage,
} from "cli/send-output";
import { access } from "node:fs/promises";
import { socketPath } from "lib/paths";
import skillContent from "../.claude/skills/tuicraft/SKILL.md" with {
  type: "text",
};

const argv = Bun.argv.slice(2);
let action: CliAction | undefined;
let failureStage: OutputStage = "arguments";

function jsonRequested(): boolean {
  if (action) return "json" in action && action.json === true;
  return hasJsonOption(argv);
}

function publicCommand(): string | null {
  if (!action) return commandNameFromArgs(argv);
  switch (action.mode) {
    case "say":
    case "slash":
    case "yell":
    case "guild":
    case "party":
    case "whisper":
      return "send";
    default:
      return action.mode.replaceAll("_", "-");
  }
}

function emit(reply: OutputEnvelope): void {
  console.log(JSON.stringify(reply));
  if (reply.error) process.exitCode = 1;
}

async function sendToSocket(command: string): Promise<string[]> {
  failureStage = "command";
  return sendRawToSocket(command);
}

async function waitForEvents(wait: number | undefined): Promise<void> {
  if (wait == null) return;
  const lines = await sendToSocket(`READ_WAIT ${wait * 1000}`);
  for (const line of lines) console.log(line);
}

function printReply(
  lines: string[],
  kind: ReplyKind,
  checkHumanErrors = false,
): OutputEnvelope | undefined {
  if (jsonRequested()) {
    const reply = decodeReply(publicCommand() ?? "", kind, lines);
    emit(reply);
    return reply;
  }
  for (const line of lines) console.log(line);
  if (checkHumanErrors && daemonCommandFailed(lines)) process.exitCode = 1;
}

function printControlReply(lines: string[]): void {
  if (jsonRequested()) printReply(lines, "intent", true);
  else {
    for (const line of formatHumanIntent(publicCommand() ?? "", lines))
      console.log(line);
    if (daemonCommandFailed(lines)) process.exitCode = 1;
  }
}
function printHumanInspection(command: string, lines: string[]): void {
  const reply = decodeReply(command, "json", lines);
  if (reply.error) {
    console.log(`ERR ${reply.error.message}`);
    process.exitCode = 1;
    return;
  }
  for (const line of formatHumanInspection(command, reply.data))
    console.log(line);
}
function printWalkReply(lines: string[]): void {
  if (jsonRequested()) {
    const reply = decodeReply(publicCommand() ?? "", "json", lines);
    if (
      !reply.error &&
      (typeof reply.data !== "object" ||
        reply.data === null ||
        !("status" in reply.data) ||
        reply.data["status"] !== "completed")
    ) {
      emit(
        errorEnvelope(
          publicCommand(),
          "command",
          "walk stopped without completion",
          reply,
        ),
      );
    } else emit(reply);
    return;
  }
  for (const line of lines) console.log(line);
  if (walkCommandFailed(lines)) process.exitCode = 1;
}

async function printSendReply(
  lines: string[],
  slash: boolean,
  wait: number | undefined,
): Promise<void> {
  if (!jsonRequested()) {
    for (const line of lines) console.log(line);
    await waitForEvents(wait);
    return;
  }

  let reply = decodeReply("send", slash ? "slash" : "intent", lines);
  if (!reply.error && wait != null) {
    try {
      const waited = decodeReply(
        "read",
        "events",
        await sendToSocket(`READ_WAIT_JSON ${wait * 1000}`),
      );
      reply = waited.error
        ? errorEnvelope("send", "wait", waited.error.message, reply)
        : { ...reply, events: waited.events };
    } catch (error) {
      reply = errorEnvelope(
        "send",
        "wait",
        error instanceof Error ? error.message : String(error),
        reply,
      );
    }
  }
  emit(reply);
}

async function main() {
  action = parseArgs(argv);
  failureStage = "startup";
  switch (action.mode) {
    case "interactive": {
      const { authWithRetry } = await import("wow/auth");
      const { worldSession } = await import("wow/client");
      const { readConfig } = await import("lib/config");
      const { configPath } = await import("lib/paths");

      if (!(await Bun.file(configPath()).exists())) {
        if (!process.stdin.isTTY) {
          throw new Error(
            "No config found. Run 'tuicraft setup' to create one.",
          );
        }
        const { runSetup } = await import("cli/setup");
        await runSetup([]);
      }

      const cfg = await readConfig();
      const clientCfg = {
        host: cfg.host,
        port: cfg.port,
        account: cfg.account.toUpperCase(),
        password: cfg.password.toUpperCase(),
        character: cfg.character,
        language: cfg.language,
        spellDataDir: cfg.spell_data_dir,
        navigationDataDir: cfg.navigation_data_dir,
        navigationLibrary: cfg.navigation_library,
        jevApiKey: process.env["TYPESAFE_API_KEY"],
        jevEndpointUrl:
          process.env["JEV_ENDPOINT_URL"] ??
          process.env["TYPESAFE_ENDPOINT_URL"],
        jevFault: process.env["JEV_FAULT"],
      };
      const auth = await authWithRetry(clientCfg);
      const handle = await worldSession(clientCfg, auth);
      const { startTui } = await import("ui/tui");
      await startTui(handle, process.stdin.isTTY ?? false);
      break;
    }
    case "daemon": {
      const { startDaemon } = await import("daemon/server");
      await startDaemon();
      break;
    }
    case "setup": {
      const { runSetup } = await import("cli/setup");
      await runSetup(action.args);
      break;
    }
    case "help": {
      const { helpText } = await import("cli/help");
      console.log(helpText());
      break;
    }
    case "version": {
      const pkg: { version: string } = await import("../package.json");
      console.log(pkg.version);
      break;
    }
    case "say":
    case "yell":
    case "guild":
    case "party": {
      await ensureDaemon();
      const cmd = `${action.mode.toUpperCase()} ${action.message}`;
      const lines = await sendToSocket(cmd);
      await printSendReply(lines, false, action.wait);
      break;
    }
    case "slash": {
      await ensureDaemon();
      const lines = await sendToSocket(action.input);
      await printSendReply(lines, true, action.wait);
      break;
    }
    case "whisper": {
      await ensureDaemon();
      const lines = await sendToSocket(
        `WHISPER ${action.target} ${action.message}`,
      );
      await printSendReply(lines, false, action.wait);
      break;
    }
    case "read": {
      await ensureDaemon();
      const base = action.json ? "READ_JSON" : "READ";
      const cmd =
        action.wait != null
          ? `${action.json ? "READ_WAIT_JSON" : "READ_WAIT"} ${action.wait * 1000}`
          : base;
      const lines = await sendToSocket(cmd);
      printReply(lines, "events");
      break;
    }
    case "tail": {
      await ensureDaemon();
      const verb = action.json ? "READ_WAIT_JSON" : "READ_WAIT";
      while (true) {
        const lines = await sendToSocket(`${verb} 1000`);
        if (action.json) {
          for (const line of lines) {
            const reply = decodeReply("tail", "events", [line]);
            emit(reply);
            if (reply.error) return;
          }
        } else for (const line of lines) console.log(line);
      }
    }
    case "start": {
      try {
        const lines = await sendToSocket("STATUS");
        if (lines.includes("CONNECTED")) {
          if (jsonRequested())
            emit(
              resultEnvelope("start", { socket: "responsive", started: false }),
            );
          else console.log("Daemon is already running.");
          break;
        }
      } catch {}
      failureStage = "startup";
      await ensureDaemon();
      const lines = await sendToSocket("STATUS");
      if (jsonRequested()) {
        if (lines.length === 1 && lines[0] === "CONNECTED")
          emit(
            resultEnvelope("start", { socket: "responsive", started: true }),
          );
        else
          emit(
            errorEnvelope(
              "start",
              "command",
              lines[0]?.startsWith("ERR ")
                ? lines[0].slice(4)
                : "Unexpected daemon reply",
            ),
          );
      } else for (const line of lines) console.log(line);
      break;
    }
    case "status": {
      try {
        const lines = await sendToSocket("STATUS");
        if (jsonRequested()) {
          if (lines.length === 1 && lines[0] === "CONNECTED")
            emit(resultEnvelope("status", { socket: "responsive" }));
          else
            emit(
              errorEnvelope(
                "status",
                "command",
                lines[0]?.startsWith("ERR ")
                  ? lines[0].slice(4)
                  : "Unexpected daemon reply",
              ),
            );
        } else for (const line of lines) console.log(line);
      } catch {
        if (jsonRequested())
          emit(resultEnvelope("status", { socket: "not_running" }));
        else console.log("Daemon is not running.");
      }
      break;
    }
    case "stop": {
      try {
        const lines = await sendToSocket("STOP");
        if (jsonRequested()) emit(decodeReply("stop", "intent", lines));
        else for (const line of lines) console.log(line);
      } catch (error) {
        if (!jsonRequested()) console.log("Daemon is not running.");
        else {
          const absent = await access(socketPath())
            .then(() => false)
            .catch(
              (probeError: unknown) =>
                probeError instanceof Error &&
                "code" in probeError &&
                probeError.code === "ENOENT",
            );
          if (absent) emit(resultEnvelope("stop", { socket: "not_running" }));
          else
            emit(
              errorEnvelope(
                "stop",
                "command",
                error instanceof Error ? error.message : String(error),
              ),
            );
        }
      }
      break;
    }
    case "who": {
      await ensureDaemon();
      const verb = action.json ? "WHO_JSON" : "WHO";
      const cmd = action.filter ? `${verb} ${action.filter}` : verb;
      const lines = await sendToSocket(cmd);
      printReply(lines, "json");
      break;
    }
    case "control": {
      await ensureDaemon();
      const cmd = action.json ? "CONTROL_JSON" : "CONTROL";
      const lines = await sendToSocket(cmd);
      printReply(lines, "json");
      break;
    }
    case "move": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`MOVE ${action.direction} ${action.durationMs}`),
      );
      break;
    }
    case "face": {
      await ensureDaemon();
      printControlReply(await sendToSocket(`FACE ${action.orientation}`));
      break;
    }
    case "face_guid": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`FACE_GUID 0x${action.guid.toString(16)}`),
      );
      break;
    }
    case "walk_toward": {
      await ensureDaemon();
      const destination =
        action.target.kind === "guid"
          ? `GUID 0x${action.target.guid.toString(16)}`
          : `POINT ${action.target.x} ${action.target.y} ${action.target.z}`;
      const lines = await sendToSocket(
        `WALK_TOWARD ${action.yards} ${destination}`,
      );
      printWalkReply(lines);
      break;
    }
    case "target": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`TARGET 0x${action.guid.toString(16)}`),
      );
      break;
    }
    case "halt": {
      await ensureDaemon();
      printControlReply(await sendToSocket("HALT"));
      break;
    }
    case "nearby": {
      await ensureDaemon();
      const base = action.json ? "NEARBY_JSON" : "NEARBY";
      const cmd = action.all ? `${base} all` : base;
      const lines = await sendToSocket(cmd);
      printReply(lines, "nearby");
      break;
    }
    case "combat":
    case "spells":
    case "tactics":
    case "cycling":
    case "navigation":
    case "recovery":
    case "quests":
    case "inventory":
    case "loot": {
      await ensureDaemon();
      const humanSummary =
        !action.json &&
        ["cycling", "recovery", "inventory", "loot"].includes(action.mode);
      const verb = `${action.mode.toUpperCase()}${action.json || humanSummary ? "_JSON" : ""}`;
      const lines = await sendToSocket(verb);
      if (humanSummary) printHumanInspection(action.mode, lines);
      else printReply(lines, "json", true);
      break;
    }
    case "cast": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(
          `CAST ${action.spellId} 0x${action.guid.toString(16)}`,
        ),
      );
      break;
    }
    case "attack": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`ATTACK 0x${action.guid.toString(16)}`),
      );
      break;
    }
    case "cancel_cast": {
      await ensureDaemon();
      printControlReply(await sendToSocket("CANCEL_CAST"));
      break;
    }
    case "stop_attack": {
      await ensureDaemon();
      printControlReply(await sendToSocket("STOP_ATTACK"));
      break;
    }
    case "fight": {
      await ensureDaemon();
      const framingPart =
        action.framing && action.framing !== "none"
          ? `--framing ${action.framing} `
          : "";
      printControlReply(
        await sendToSocket(
          `FIGHT ${framingPart}0x${action.guid.toString(16)} ${action.instruction}`,
        ),
      );
      break;
    }
    case "cycle": {
      await ensureDaemon();
      const guidsPart = action.guids
        .map((guid) => `0x${guid.toString(16)}`)
        .join(" ");
      printControlReply(
        await sendToSocket(
          `CYCLE ${guidsPart} --max ${action.maxStarts} --instruction ${action.instruction}`,
        ),
      );
      break;
    }
    case "open_loot": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`OPEN_LOOT 0x${action.guid.toString(16)}`),
      );
      break;
    }
    case "take_loot": {
      await ensureDaemon();
      printControlReply(await sendToSocket(`TAKE_LOOT ${action.slot}`));
      break;
    }
    case "take_money":
    case "release_loot": {
      await ensureDaemon();
      printControlReply(await sendToSocket(action.mode.toUpperCase()));
      break;
    }
    case "talk": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`TALK 0x${action.guid.toString(16)}`),
      );
      break;
    }
    case "query_quest":
    case "select_quest":
    case "complete_quest": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`${action.mode.toUpperCase()} ${action.questId}`),
      );
      break;
    }
    case "select_option": {
      await ensureDaemon();
      const code = JSON.stringify(action.code ?? null);
      printControlReply(
        await sendToSocket(`SELECT_OPTION ${action.optionId} ${code}`),
      );
      break;
    }
    case "choose_reward": {
      await ensureDaemon();
      printControlReply(await sendToSocket(`CHOOSE_REWARD ${action.index}`));
      break;
    }
    case "abandon_quest": {
      await ensureDaemon();
      printControlReply(await sendToSocket(`ABANDON_QUEST ${action.slot}`));
      break;
    }
    case "accept_quest":
    case "request_reward":
    case "cancel_interaction": {
      await ensureDaemon();
      printControlReply(await sendToSocket(action.mode.toUpperCase()));
      break;
    }
    case "query_corpse":
    case "release_spirit":
    case "reclaim_corpse": {
      await ensureDaemon();
      printControlReply(await sendToSocket(action.mode.toUpperCase()));
      break;
    }
    case "spirit_healer": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`SPIRIT_HEALER 0x${action.guid.toString(16)}`),
      );
      break;
    }
    case "resurrect": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`RESURRECT ${action.accept ? "accept" : "decline"}`),
      );
      break;
    }
    case "goto": {
      await ensureDaemon();
      printControlReply(
        await sendToSocket(`GOTO ${action.x} ${action.y} ${action.z}`),
      );
      break;
    }
    case "skill": {
      process.stdout.write(skillContent);
      break;
    }
    case "logs": {
      const { logPath } = await import("lib/paths");
      const file = Bun.file(logPath());
      if (await file.exists()) {
        console.log(await file.text());
      } else {
        console.log("No session log found.");
      }
      break;
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (jsonRequested())
    emit(errorEnvelope(publicCommand(), failureStage, message));
  else console.error(message);
  process.exitCode = 1;
});
