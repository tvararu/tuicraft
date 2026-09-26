import { access } from "node:fs/promises";
import {
  type CliAction,
  commandNameFromArgs,
  hasJsonOption,
  parseArgs,
} from "cli/args";
import { ensureDaemon, sendToSocket as sendRawToSocket } from "cli/ipc";
import {
  type Inspection,
  inspectionLine,
  isInspection,
  requestLine,
} from "cli/request";
import {
  daemonCommandFailed,
  decodeReply,
  errorEnvelope,
  formatHumanIntent,
  type JsonValue,
  type OutputEnvelope,
  type OutputStage,
  type ReplyKind,
  resultEnvelope,
  walkCommandFailed,
} from "cli/send-output";
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
    case "cycle_resume":
      return "cycle";
    default:
      return action.mode.replaceAll("_", "-");
  }
}

function emit(reply: OutputEnvelope): void {
  console.log(JSON.stringify(reply));
  if (reply.error) process.exitCode = 1;
}

function sendToSocket(command: string): Promise<string[]> {
  failureStage = "command";
  return sendRawToSocket(command);
}

async function waitForEvents(wait: number | undefined): Promise<void> {
  if (wait === undefined) return;
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

async function printInspection(inspection: Inspection): Promise<void> {
  printReply(await sendToSocket(inspectionLine(inspection)), "json", true);
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
  if (!reply.error && wait !== undefined) {
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

type ActionOf<M extends CliAction["mode"]> = Extract<CliAction, { mode: M }>;

async function runInteractive(): Promise<void> {
  const { authWithRetry } = await import("wow/auth");
  const { worldSession } = await import("wow/client");
  const { readConfig, clientConfig } = await import("lib/config");
  if (!(await Bun.file(resolvePaths().configPath).exists())) {
    if (!process.stdin.isTTY) {
      throw new Error("No config found. Run 'tuicraft setup' to create one.");
    }
    const { runSetup } = await import("cli/setup");
    await runSetup([]);
  }

  const clientCfg = clientConfig(await readConfig());
  const auth = await authWithRetry(clientCfg);
  const handle = await worldSession(clientCfg, auth);
  const { startTui } = await import("ui/tui");
  await startTui(handle, process.stdin.isTTY ?? false);
}

async function runDaemon(): Promise<void> {
  const { startDaemon } = await import("daemon/server");
  await startDaemon();
}

async function runSetupCommand(args: ActionOf<"setup">["args"]) {
  const { runSetup } = await import("cli/setup");
  await runSetup(args);
}

async function runHelp(): Promise<void> {
  const { helpText } = await import("cli/help");
  console.log(helpText());
}

async function runVersion(): Promise<void> {
  const pkg: { version: string } = await import("../package.json");
  console.log(pkg.version);
}

async function runSend(
  sendAction: ActionOf<
    "say" | "yell" | "guild" | "party" | "slash" | "whisper"
  >,
): Promise<void> {
  await ensureDaemon();
  if (sendAction.mode === "slash") {
    const lines = await sendToSocket(sendAction.input);
    await printSendReply(lines, true, sendAction.wait);
    return;
  }
  if (sendAction.mode === "whisper") {
    const lines = await sendToSocket(
      `WHISPER ${sendAction.target} ${sendAction.message}`,
    );
    await printSendReply(lines, false, sendAction.wait);
    return;
  }
  const cmd = `${sendAction.mode.toUpperCase()} ${sendAction.message}`;
  const lines = await sendToSocket(cmd);
  await printSendReply(lines, false, sendAction.wait);
}

async function runRead(readAction: ActionOf<"read">): Promise<void> {
  await ensureDaemon();
  const base = readAction.json ? "READ_JSON" : "READ";
  const cmd =
    readAction.wait === undefined
      ? base
      : `${readAction.json ? "READ_WAIT_JSON" : "READ_WAIT"} ${readAction.wait * 1000}`;
  const lines = await sendToSocket(cmd);
  printReply(lines, "events");
}

function emitTailEvents(lines: string[]): boolean {
  for (const line of lines) {
    const reply = decodeReply("tail", "events", [line]);
    emit(reply);
    if (reply.error) return false;
  }
  return true;
}

async function runTail(tailAction: ActionOf<"tail">): Promise<void> {
  await ensureDaemon();
  const verb = tailAction.json ? "TAIL_WAIT_JSON" : "TAIL_WAIT";
  while (true) {
    const lines = await sendToSocket(`${verb} 1000`);
    if (!tailAction.json) for (const line of lines) console.log(line);
    else if (!emitTailEvents(lines)) return;
  }
}

async function runStart(): Promise<void> {
  const running = await sendToSocket("STATUS").then(
    (statusLines) => statusLines.includes("CONNECTED"),
    () => false,
  );
  if (running) {
    if (jsonRequested())
      emit(resultEnvelope("start", { socket: "responsive", started: false }));
    else console.log("Daemon is already running.");
    return;
  }
  failureStage = "startup";
  await ensureDaemon();
  const lines = await sendToSocket("STATUS");
  printStatus("start", lines, { socket: "responsive", started: true });
}

async function runStatus(): Promise<void> {
  const lines = await sendToSocket("STATUS").catch(() => undefined);
  if (lines) printStatus("status", lines, { socket: "responsive" });
  else if (jsonRequested())
    emit(resultEnvelope("status", { socket: "not_running" }));
  else console.log("Daemon is not running.");
}

async function reportStopFailure(error: unknown): Promise<void> {
  if (!jsonRequested()) {
    console.log("Daemon is not running.");
    return;
  }
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

async function runStop(): Promise<void> {
  try {
    const lines = await sendToSocket("STOP");
    if (jsonRequested()) emit(decodeReply("stop", "intent", lines));
    else for (const line of lines) console.log(line);
  } catch (error) {
    await reportStopFailure(error);
  }
}

async function runWho(whoAction: ActionOf<"who">): Promise<void> {
  await ensureDaemon();
  const verb = whoAction.json ? "WHO_JSON" : "WHO";
  const cmd = whoAction.filter ? `${verb} ${whoAction.filter}` : verb;
  const lines = await sendToSocket(cmd);
  printReply(lines, "json");
}

async function runNearby(nearbyAction: ActionOf<"nearby">): Promise<void> {
  await ensureDaemon();
  const base = nearbyAction.json ? "NEARBY_JSON" : "NEARBY";
  const cmd = nearbyAction.all ? `${base} all` : base;
  const lines = await sendToSocket(cmd);
  printReply(lines, "nearby");
}

async function runLogs(): Promise<void> {
  const file = Bun.file(resolvePaths().logPath);
  if (await file.exists()) {
    console.log(await file.text());
  } else {
    console.log("No session log found.");
  }
}

async function runAction(cliAction: CliAction): Promise<void> {
  switch (cliAction.mode) {
    case "interactive":
      return runInteractive();
    case "daemon":
      return runDaemon();
    case "setup":
      return runSetupCommand(cliAction.args);
    case "help":
      return runHelp();
    case "version":
      return runVersion();
    case "say":
    case "yell":
    case "guild":
    case "party":
    case "slash":
    case "whisper":
      return runSend(cliAction);
    case "read":
      return runRead(cliAction);
    case "tail":
      return runTail(cliAction);
    case "start":
      return runStart();
    case "status":
      return runStatus();
    case "stop":
      return runStop();
    case "who":
      return runWho(cliAction);
    case "nearby":
      return runNearby(cliAction);
    case "walk_toward":
      await ensureDaemon();
      return printWalkReply(await sendToSocket(requestLine(cliAction)));
    case "skill":
      process.stdout.write(skillContent);
      return;
    case "logs":
      return runLogs();
    default:
      await ensureDaemon();
      if (isInspection(cliAction)) await printInspection(cliAction);
      else printControlReply(await sendToSocket(requestLine(cliAction)));
  }
}

async function main() {
  action = parseArgs(argv);
  failureStage = "startup";
  await runAction(action);
}

main().catch((error) => {
  const message = messageOf(error);
  if (jsonRequested())
    emit(errorEnvelope(publicCommand(), failureStage, message));
  else console.error(message);
  process.exitCode = 1;
});
