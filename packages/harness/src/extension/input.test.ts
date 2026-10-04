import { describe, expect, jest, test } from "bun:test";
import type { RunEnd } from "#harness/contract/runs";
import {
  humanStop,
  installInput,
  isStopReflex,
} from "#harness/extension/input";
import { createYieldGate, YIELD_DELAY_MS } from "#harness/runtime/yield";
import { admitAgent } from "#harness/tools/human-admission";
import { createFakePi } from "#test-support/fake-pi";
import {
  createTestRuntime,
  type TestRuntimeInit,
} from "#test-support/runtime-fixture";

function waitForAbort(signal: AbortSignal): Promise<RunEnd<undefined>> {
  const { promise, resolve } = Promise.withResolvers<RunEnd<undefined>>();
  signal.addEventListener("abort", () =>
    resolve({
      reason: (signal.reason as Error).message,
      status: "cancelled",
      summary: "stopped",
      value: undefined,
    }),
  );
  return promise;
}

async function setup(
  flags: { stopReflex?: boolean } = {},
  parts: TestRuntimeInit["parts"] = {},
) {
  const { rt, handle } = await createTestRuntime({ flags, parts });
  const fake = createFakePi();
  installInput(fake.api, rt);
  return { fake, handle, rt };
}

const human = (text: string) => ({
  source: "interactive",
  text,
  type: "input",
});

describe("isStopReflex", () => {
  test.each([
    "stop",
    "Stop!",
    "Stop! Stop right now.",
    "Stop, we're done.",
    "HALT",
    "freeze now",
    "hold on",
  ])("matches %p", (text) => {
    expect(isStopReflex(text)).toBe(true);
  });

  test.each([
    "wait",
    "please stop",
    "stop and then go north past the big tree",
    "",
    "stopwatch",
  ])("does not match %p", (text) => {
    expect(isStopReflex(text)).toBe(false);
  });
});

describe("installInput", () => {
  test("a stop reflex cancels the run, halts the character and logs the stopped runs", async () => {
    const { fake, handle, rt } = await setup();
    rt.runs.start({
      args: {},
      kind: "engage",
      launch: ({ signal }) => waitForAbort(signal),
      toolCallId: "t1",
    });
    const [result] = await fake.emit(human("Stop! Stop right now."));
    expect(result).toEqual({ action: "continue" });
    expect(rt.runs.get("r1")).toMatchObject({
      reason: "human_stop",
      status: "cancelled",
    });
    expect(handle.halt).toHaveBeenCalled();
    expect(rt.log.recent(1)[0]).toMatchObject({
      data: { stoppedRuns: ["r1"], stopReflex: true, via: "reflex" },
      event: "human/input",
    });
  });

  test("--stop-reflex off lets a stop message through without stopping", async () => {
    const { fake, handle, rt } = await setup({ stopReflex: false });
    await fake.emit(human("stop"));
    expect(handle.halt).not.toHaveBeenCalled();
    expect(rt.log.recent(1)[0]).toMatchObject({
      data: { stopReflex: false, via: "input" },
    });
  });

  test("human text while the agent works sets humanWaiting and triggers a yield", async () => {
    const { fake, rt } = await setup({}, { yields: createYieldGate() });
    jest.useFakeTimers();
    try {
      let yielded = false;
      rt.yields.wait().then(() => {
        yielded = true;
      });
      await fake.emit({ type: "agent_start" });
      await fake.emit({
        args: {},
        toolCallId: "c1",
        toolName: "engage",
        type: "tool_execution_start",
      });
      await fake.emit(human("how much health do you have?"));
      expect(rt.session.humanWaiting).toBe(true);
      expect(rt.session.humanTexts).toEqual(["how much health do you have?"]);
      jest.advanceTimersByTime(YIELD_DELAY_MS - 1);
      await Promise.resolve();
      expect(yielded).toBe(false);
      jest.advanceTimersByTime(1);
      await Promise.resolve();
      expect(yielded).toBe(true);
      await fake.emit(human("and your mana?"));
      expect(rt.session.humanTexts).toEqual([
        "how much health do you have?",
        "and your mana?",
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
  describe("clearing humanWaiting", () => {
    const delivered = (text: string) => ({
      message: { content: [{ text, type: "text" }], role: "user" },
      type: "message_start",
    });
    const started = {
      message: { content: [], role: "assistant" },
      type: "message_start",
    };
    const said = (text: string) => ({
      message: { content: [{ text, type: "text" }], role: "assistant" },
      type: "message_end",
    });
    const call = (toolName: string, type: string) => ({
      args: {},
      isError: false,
      result: {},
      toolCallId: "c1",
      toolName,
      type,
    });

    async function pending() {
      const ctx = await setup({}, { yields: createYieldGate() });
      await ctx.fake.emit({ type: "agent_start" });
      await ctx.fake.emit(human("how much health do you have?"));
      return ctx;
    }

    test("new turns and read-only calls keep it set", async () => {
      const { fake, rt } = await pending();
      await fake.emit({ timestamp: 0, turnIndex: 1, type: "turn_start" });
      await fake.emit(call("look", "tool_execution_start"));
      await fake.emit(call("look", "tool_execution_end"));
      await fake.emit({ timestamp: 0, turnIndex: 2, type: "turn_start" });
      expect(rt.session.humanWaiting).toBe(true);
      expect(() => admitAgent(rt, "engage")).toThrow("human_waiting");
    });

    test("an assistant reply after the human text is delivered clears it", async () => {
      const { fake, rt } = await pending();
      await fake.emit(delivered("how much health do you have?"));
      await fake.emit(started);
      await fake.emit(said("I have 80% health and 40% mana."));
      expect(rt.session).toMatchObject({ humanTexts: [], humanWaiting: false });
      expect(() => admitAgent(rt, "engage")).not.toThrow();
    });

    test("a reply already streaming when the human wrote does not clear it", async () => {
      const { fake, rt } = await setup({}, { yields: createYieldGate() });
      await fake.emit({ type: "agent_start" });
      await fake.emit(started);
      await fake.emit(human("how much health do you have?"));
      await fake.emit(said("Engaging the wolf."));
      expect(rt.session.humanWaiting).toBe(true);
    });

    test("a response whose start is delayed past the human text does not clear it", async () => {
      const { fake, rt } = await setup({}, { yields: createYieldGate() });
      await fake.emit({ type: "agent_start" });
      await fake.emit(human("how much health do you have?"));
      await fake.emit(started);
      await fake.emit(said("Engaging the wolf."));
      expect(rt.session.humanWaiting).toBe(true);
      expect(() => admitAgent(rt, "engage")).toThrow("human_waiting");
    });

    test("an unrelated user message does not arm the reply", async () => {
      const { fake, rt } = await setup({}, { yields: createYieldGate() });
      await fake.emit({ type: "agent_start" });
      await fake.emit(delivered("[now 12:00]"));
      await fake.emit(human("how much health do you have?"));
      await fake.emit(started);
      await fake.emit(said("Engaging the wolf."));
      expect(rt.session.humanWaiting).toBe(true);
    });

    test("an assistant message without text does not clear it", async () => {
      const { fake, rt } = await pending();
      await fake.emit(delivered("how much health do you have?"));
      await fake.emit(started);
      await fake.emit(said("  "));
      expect(rt.session.humanWaiting).toBe(true);
    });

    test("an unanswered question survives an errored run and its retry", async () => {
      const { fake, rt } = await pending();
      await fake.emit(delivered("how much health do you have?"));
      await fake.emit(started);
      await fake.emit({ messages: [], type: "agent_end" });
      expect(rt.session).toMatchObject({
        agent: "idle",
        humanTexts: ["how much health do you have?"],
        humanWaiting: true,
      });
      await fake.emit({ type: "agent_start" });
      expect(() => admitAgent(rt, "engage")).toThrow("human_waiting");
      await fake.emit(started);
      await fake.emit(said("I have 80% health."));
      expect(() => admitAgent(rt, "engage")).not.toThrow();
    });

    test("a reply covers only the human messages that reached it", async () => {
      const { fake, rt } = await pending();
      await fake.emit(human("and your mana?"));
      await fake.emit(delivered("how much health do you have?"));
      await fake.emit(started);
      await fake.emit(said("I have 80% health."));
      expect(rt.session.humanTexts).toEqual(["and your mana?"]);
      expect(() => admitAgent(rt, "engage")).toThrow("human_waiting");
      await fake.emit(delivered("and your mana?"));
      await fake.emit(started);
      await fake.emit(said("I have 40% mana."));
      expect(() => admitAgent(rt, "engage")).not.toThrow();
    });
  });

  test("an idle stop reflex stops nothing, logs the text and does not set humanWaiting", async () => {
    const { fake, rt } = await setup();
    await fake.emit(human("stop"));
    expect(rt.session.humanWaiting).toBe(false);
    expect(rt.log.recent(1)[0]).toMatchObject({
      data: { stoppedRuns: [] },
      text: "Human: stop",
    });
  });

  test("text that an extension sends is not human input", async () => {
    const { fake, rt } = await setup();
    await fake.emit({ source: "extension", text: "stop", type: "input" });
    expect(rt.log.recent(1)[0]?.event).not.toBe("human/input");
  });

  test("tracks the agent state through a turn", async () => {
    const { fake, rt } = await setup();
    await fake.emit({ type: "agent_start" });
    expect(rt.session).toMatchObject({ agent: "streaming", turnToolCalls: 0 });
    rt.session.humanWaiting = true;
    rt.session.humanTexts = ["rest first"];
    await fake.emit({ timestamp: 0, turnIndex: 0, type: "turn_start" });
    expect(rt.session.humanWaiting).toBe(true);
    expect(rt.session.humanTexts).toEqual(["rest first"]);
    await fake.emit({
      args: {},
      toolCallId: "c1",
      toolName: "look",
      type: "tool_execution_start",
    });
    expect(rt.session).toMatchObject({ agent: "tool", tool: "look" });
    await fake.emit({
      isError: false,
      result: {},
      toolCallId: "c1",
      toolName: "look",
      type: "tool_execution_end",
    });
    expect(rt.session).toMatchObject({ agent: "streaming", tool: undefined });
    await fake.emit({ messages: [], type: "agent_end" });
    expect(rt.session.agent).toBe("idle");
  });

  test("logs assistant text as agent/message", async () => {
    const { fake, rt } = await setup();
    await fake.emit({
      message: {
        content: [{ text: "I am level 10.", type: "text" }],
        role: "assistant",
      },
      type: "message_end",
    });
    expect(rt.log.recent(1)[0]).toMatchObject({
      event: "agent/message",
      text: "I am level 10.",
    });
  });

  test("a run that outlives the turn passes to the loop", async () => {
    const { fake, rt } = await setup();
    await fake.emit({ type: "agent_start" });
    admitAgent(rt, "travel");
    rt.runs.start({
      args: {},
      kind: "travel",
      launch: ({ signal }) => waitForAbort(signal),
      toolCallId: "t1",
    });
    await fake.emit({ messages: [], type: "agent_end" });
    expect(rt.control.owner()).toBe("loop");
    expect(rt.runs.get("r1")?.status).toBe("running");
  });

  test("a background run ending frees the body", async () => {
    const { fake, rt } = await setup();
    const { promise, resolve } = Promise.withResolvers<RunEnd<undefined>>();
    rt.runs.start({
      args: {},
      kind: "rest",
      launch: () => promise,
      toolCallId: "t1",
    });
    await fake.emit({ messages: [], type: "agent_end" });
    expect(rt.control.owner()).toBe("loop");
    resolve({ status: "succeeded", summary: "rested", value: undefined });
    await Bun.sleep(0);
    expect(rt.control.owner()).toBe("none");
  });

  test("a run's end frees only the loop grant it was handed, not a newer claim", async () => {
    const { fake, rt } = await setup();
    const { promise, resolve } = Promise.withResolvers<RunEnd<undefined>>();
    rt.runs.start({
      args: {},
      kind: "rest",
      launch: () => promise,
      toolCallId: "t1",
    });
    await fake.emit({ messages: [], type: "agent_end" });
    const probe = rt.control.claim("loop", "probe");
    resolve({ status: "succeeded", summary: "rested", value: undefined });
    await Bun.sleep(0);
    expect(probe.granted && rt.control.holds(probe.grant)).toBe(true);
  });

  test("a stop reflex pre-empts the agent and hands the body back free", async () => {
    const { fake, rt } = await setup();
    rt.control.claim("agent", "engage");
    rt.runs.start({
      args: {},
      kind: "engage",
      launch: ({ signal }) => waitForAbort(signal),
      toolCallId: "t1",
    });
    await fake.emit(human("stop"));
    expect(rt.runs.get("r1")?.reason).toBe("human_stop");
    expect(rt.control.owner()).toBe("none");
  });

  test("a stop while the human drives stops everything and keeps the human in control", async () => {
    const { fake, handle, rt } = await setup();
    rt.control.claim("human", "drive");
    rt.runs.start({
      args: {},
      kind: "rest",
      launch: ({ signal }) => waitForAbort(signal),
      toolCallId: "t1",
    });
    await fake.press("f9");
    expect(rt.runs.get("r1")?.reason).toBe("human_stop");
    expect(handle.halt).toHaveBeenCalled();
    expect(rt.control.owner()).toBe("human");
  });

  test("F9 stops every run", async () => {
    const { fake, rt } = await setup();
    rt.runs.start({
      args: {},
      kind: "rest",
      launch: ({ signal }) => waitForAbort(signal),
      toolCallId: "t1",
    });
    await fake.press("f9");
    expect(rt.runs.get("r1")?.status).toBe("cancelled");
    expect(rt.log.recent(1)[0]).toMatchObject({
      data: { via: "key" },
      text: "Human: F9",
    });
  });
});

test("humanStop returns the cancelled records", async () => {
  const { rt } = await createTestRuntime();
  rt.runs.start({
    args: {},
    kind: "travel",
    launch: ({ signal }) => waitForAbort(signal),
    toolCallId: "t1",
  });
  expect(
    humanStop({ rt, text: "/stop", via: "command" }).map((run) => run.id),
  ).toEqual(["r1"]);
});
