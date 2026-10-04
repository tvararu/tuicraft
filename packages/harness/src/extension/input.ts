import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  InputEvent,
  InputEventResult,
} from "@earendil-works/pi-coding-agent";
import type { RunRecord } from "#harness/contract/runs";
import type { HarnessRuntime } from "#harness/contract/services";

type Via = "reflex" | "command" | "key";
type HumanRow = {
  text: string;
  via: Via | "input";
  stopReflex: boolean;
  stoppedRuns: string[];
};

export const STOP_WORDS: readonly string[] = ["stop", "halt", "freeze", "hold"];
export const STOP_MAX_WORDS = 5;
const STOP_KEYS = [
  ["f9", "F9"],
  ["ctrl+\\", "Ctrl+\\"],
] as const;

const PUNCTUATION = /[^\p{L}\p{N}]/gu;
const SPACES = /\s+/;

export function isStopReflex(text: string): boolean {
  const words = text
    .trim()
    .split(SPACES)
    .filter((word) => word.length > 0);
  const first = words[0]?.replace(PUNCTUATION, "").toLowerCase() ?? "";
  return words.length <= STOP_MAX_WORDS && STOP_WORDS.includes(first);
}

export function humanStop(init: {
  rt: HarnessRuntime;
  via: Via;
  text: string;
}): RunRecord[] {
  const stopped = stopAsHuman(init.rt, init.via);
  appendHuman(init.rt, {
    stoppedRuns: stopped.map((run) => run.id),
    stopReflex: true,
    text: init.text,
    via: init.via,
  });
  return stopped;
}

export function installInput(pi: ExtensionAPI, rt: HarnessRuntime): void {
  const { session } = rt;
  pi.on("input", (event) => onInput(rt, event));
  pi.on("agent_start", () => {
    Object.assign(session, {
      agent: "streaming",
      turnStartSeq: rt.log.lastSeq(),
      turnToolCalls: 0,
    });
  });
  pi.on("message_start", (event) => {
    if (!session.humanWaiting) return;
    const text = userText(event.message);
    if (text === undefined || !session.humanTexts.includes(text)) return;
    const delivered = session.deliveredTexts.filter((seen) => seen === text).length;
    const pending = session.humanTexts.filter((seen) => seen === text).length;
    if (delivered >= pending) return;
    session.deliveredTexts = [...session.deliveredTexts, text];
  });
  pi.on("tool_execution_start", (event) => {
    Object.assign(session, {
      agent: "tool",
      lastToolCallAt: rt.clock.now(),
      tool: event.toolName,
    });
  });
  pi.on("tool_execution_end", () => {
    Object.assign(session, { agent: "streaming", tool: undefined });
  });
  pi.on("agent_end", () => {
    Object.assign(session, {
      agent: "idle",
      tool: undefined,
    });
    handToLoop(rt);
  });
  pi.on("message_end", (event) => noteAssistant(rt, event.message));
  for (const [key, text] of STOP_KEYS)
    pi.registerShortcut(key, {
      description: "Stop every action now.",
      handler: () => void humanStop({ rt, text, via: "key" }),
    });
}

function stopAsHuman(rt: HarnessRuntime, via: Via): RunRecord[] {
  const { control } = rt;
  if (control.owner() === "human") return rt.stopAll("human");
  const claim = control.claim("human", via);
  if (!claim.granted) return [];
  control.release(claim.grant, via);
  return claim.stopped;
}

function handToLoop(rt: HarnessRuntime): void {
  const { control, runs, session } = rt;
  if (session.agentGrant) control.release(session.agentGrant, "turn_ended");
  session.agentGrant = undefined;
  const run = runs.active();
  if (!run || control.owner() !== "none") return;
  const claim = control.claim("loop", "run_outlived_turn");
  if (!claim.granted) return;
  const off = runs.subscribe((event) => {
    if (event.type !== "ended" || event.record.id !== run.id) return;
    off();
    control.release(claim.grant, "run_ended");
  });
}

function onInput(rt: HarnessRuntime, event: InputEvent): InputEventResult {
  if (event.source === "extension") return { action: "continue" };
  if (rt.flags.stopReflex && isStopReflex(event.text))
    humanStop({ rt, text: event.text, via: "reflex" });
  else
    appendHuman(rt, {
      stoppedRuns: [],
      stopReflex: false,
      text: event.text,
      via: "input",
    });
  if (rt.session.agent !== "idle") {
    rt.session.humanWaiting = true;
    rt.session.humanTexts = [...rt.session.humanTexts, event.text];
    rt.yields.trigger();
  }
  return { action: "continue" };
}

function appendHuman(rt: HarnessRuntime, row: HumanRow): void {
  rt.log.append({
    class: "log",
    data: row,
    domain: "human",
    event: "human/input",
    text: `Human: ${row.text}`,
  });
}

function userText(message: AgentMessage): string | undefined {
  if (!("role" in message) || message.role !== "user") return undefined;
  const content = message.content;
  const text =
    typeof content === "string"
      ? content
      : content
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("");
  return text.length === 0 ? undefined : text;
}

function noteAssistant(rt: HarnessRuntime, message: AgentMessage): void {
  if (!("role" in message) || message.role !== "assistant") return;
  const text = message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
  if (text.trim().length === 0) return;
  if (rt.session.deliveredTexts.length > 0) {
    const outstanding = [...rt.session.deliveredTexts];
    rt.session.humanTexts = rt.session.humanTexts.filter((item) => {
      const at = outstanding.indexOf(item);
      if (at === -1) return true;
      outstanding.splice(at, 1);
      return false;
    });
    rt.session.deliveredTexts = outstanding.filter((item) => rt.session.humanTexts.includes(item));
    if (rt.session.humanTexts.length === 0) rt.session.humanWaiting = false;
  }
  rt.log.append({
    class: "log",
    data: { text },
    domain: "agent",
    event: "agent/message",
    text,
  });
}
