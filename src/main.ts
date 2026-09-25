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
  formatHumanIntent,
  type ReplyKind,
  type OutputEnvelope,
  type OutputStage,
  type JsonValue,
} from "cli/send-output";
import { access } from "node:fs/promises";
import {
  isInspection,
  inspectionLine,
  requestLine,
  type Inspection,
} from "cli/request";
import { messageOf } from "lib/errors";
import { resolvePaths } from "lib/paths";
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
function printWalkReply(lines: string[]): void {
  const failed = walkCommandFailed(lines);
  if (!jsonRequested()) {
    for (const line of lines) console.log(line);
    if (failed) process.exitCode = 1;
    return;
  }
  const reply = decodeReply(publicCommand() ?? "", "json", lines);
  if (reply.error || !failed) emit(reply);
  else
    emit(
      errorEnvelope(
        publicCommand(),
        "command",
        "walk stopped without completion",
      ),
    );
}

function printStatus(command: string, lines: string[], data: JsonValue): void {
  if (!jsonRequested()) {
    for (const line of lines) console.log(line);
    return;
  }
  if (lines.length === 1 && lines[0] === "CONNECTED")
    emit(resultEnvelope(command, data));
  else {
    const message = lines[0]?.startsWith("ERR ")
      ? lines[0].slice(4)
      : "Unexpected daemon reply";
    emit(errorEnvelope(command, "command", message));
  }
}

async function printInspection(action: Inspection): Promise<void> {
  printReply(await sendToSocket(inspectionLine(action)), "json", true);
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
      reply = errorEnvelope("send", "wait", messageOf(error), reply);
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
      const { readConfig, clientConfig } = await import("lib/config");
      if (!(await Bun.file(resolvePaths().configPath).exists())) {
        if (!process.stdin.isTTY) {
          throw new Error(
            "No config found. Run 'tuicraft setup' to create one.",
          );
        }
        const { runSetup } = await import("cli/setup");
        await runSetup([]);
      }

      const clientCfg = clientConfig(await readConfig());
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
      const running = await sendToSocket("STATUS").then(
        (lines) => lines.includes("CONNECTED"),
        () => false,
      );
      if (running) {
        if (jsonRequested())
          emit(
            resultEnvelope("start", { socket: "responsive", started: false }),
          );
        else console.log("Daemon is already running.");
        break;
      }
      failureStage = "startup";
      await ensureDaemon();
      const lines = await sendToSocket("STATUS");
      printStatus("start", lines, { socket: "responsive", started: true });
      break;
    }
    case "status": {
      const lines = await sendToSocket("STATUS").catch(() => undefined);
      if (lines) printStatus("status", lines, { socket: "responsive" });
      else if (jsonRequested())
        emit(resultEnvelope("status", { socket: "not_running" }));
      else console.log("Daemon is not running.");
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
          const absent = await access(resolvePaths().socketPath)
            .then(() => false)
            .catch(
              (probeError: unknown) =>
                probeError instanceof Error &&
                "code" in probeError &&
                probeError.code === "ENOENT",
            );
          if (absent) emit(resultEnvelope("stop", { socket: "not_running" }));
          else emit(errorEnvelope("stop", "command", messageOf(error)));
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
    case "nearby": {
      await ensureDaemon();
      const base = action.json ? "NEARBY_JSON" : "NEARBY";
      const cmd = action.all ? `${base} all` : base;
      const lines = await sendToSocket(cmd);
      printReply(lines, "nearby");
      break;
    }
    case "walk_toward": {
      await ensureDaemon();
      printWalkReply(await sendToSocket(requestLine(action)));
      break;
    }
    case "skill": {
      process.stdout.write(skillContent);
      break;
    }
    case "logs": {
      const file = Bun.file(resolvePaths().logPath);
      if (await file.exists()) {
        console.log(await file.text());
      } else {
        console.log("No session log found.");
      }
      break;
    }
    default: {
      await ensureDaemon();
      if (isInspection(action)) await printInspection(action);
      else printControlReply(await sendToSocket(requestLine(action)));
    }
  }
}

main().catch((error) => {
  const message = messageOf(error);
  if (jsonRequested())
    emit(errorEnvelope(publicCommand(), failureStage, message));
  else console.error(message);
  process.exitCode = 1;
});
