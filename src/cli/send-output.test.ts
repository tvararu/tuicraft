import { describe, expect, test } from "bun:test";
import {
  daemonCommandFailed,
  walkCommandFailed,
  decodeReply,
  errorEnvelope,
  formatHumanIntent,
} from "cli/send-output";

describe("decodeReply", () => {
  test.each([
    "OK",
    "OK WHISPER Aria",
  ])("treats %s as an intent acknowledgment", (line) => {
    expect(decodeReply("send", "intent", [line])).toEqual({
      command: "send",
      kind: "intent",
      data: null,
      events: [],
      error: null,
    });
  });

  test("treats a slash OK reply as an intent", () => {
    expect(decodeReply("send", "slash", ["OK"])).toEqual({
      command: "send",
      kind: "intent",
      data: null,
      events: [],
      error: null,
    });
  });

  test("reports ERR instead of fabricated chat success", () => {
    expect(decodeReply("send", "intent", ["ERR rooted"])).toEqual({
      command: "send",
      kind: "error",
      data: null,
      events: [],
      error: { stage: "command", message: "rooted" },
    });
  });

  test("reports UNIMPLEMENTED before slash text", () => {
    expect(
      decodeReply("send", "slash", ["UNIMPLEMENTED Mail reading"]),
    ).toEqual({
      command: "send",
      kind: "error",
      data: null,
      events: [],
      error: { stage: "command", message: "Mail reading" },
    });
  });

  test("prioritizes daemon errors over event objects", () => {
    expect(
      decodeReply("read", "events", ['{"type":"SAY"}', "ERR read failed"]),
    ).toEqual({
      command: "read",
      kind: "error",
      data: null,
      events: [],
      error: { stage: "command", message: "read failed" },
    });
  });

  test("keeps a single JSON object as result data", () => {
    expect(
      decodeReply("who", "json", ['{"players":[{"name":"Aria"}]}']),
    ).toEqual({
      command: "who",
      kind: "result",
      data: { players: [{ name: "Aria" }] },
      events: [],
      error: null,
    });
  });

  test("keeps a single JSON array as result data", () => {
    expect(decodeReply("spells", "json", ['[{"id":5},9]'])).toEqual({
      command: "spells",
      kind: "result",
      data: [{ id: 5 }, 9],
      events: [],
      error: null,
    });
  });

  test("collects multiple nearby objects in result data", () => {
    expect(
      decodeReply("nearby", "nearby", ['{"guid":"0x1"}', '{"guid":"0x2"}']),
    ).toEqual({
      command: "nearby",
      kind: "result",
      data: [{ guid: "0x1" }, { guid: "0x2" }],
      events: [],
      error: null,
    });
  });

  test("returns an empty result for an empty nearby reply", () => {
    expect(decodeReply("nearby", "nearby", [])).toEqual({
      command: "nearby",
      kind: "result",
      data: [],
      events: [],
      error: null,
    });
  });

  test("rejects a non-object nearby entry", () => {
    expect(
      decodeReply("nearby", "nearby", ['{"guid":"0x1"}', "7"]),
    ).toMatchObject({
      command: "nearby",
      kind: "error",
      data: null,
      events: [],
      error: { stage: "command" },
    });
  });

  test("collects multiple parsed event objects", () => {
    expect(
      decodeReply("read", "events", [
        '{"type":"SAY","message":"hi"}',
        '{"type":"WHISPER","message":"bye"}',
      ]),
    ).toEqual({
      command: "read",
      kind: "events",
      data: null,
      events: [
        { type: "SAY", message: "hi" },
        { type: "WHISPER", message: "bye" },
      ],
      error: null,
    });
  });

  test("returns an empty event envelope for an empty read", () => {
    expect(decodeReply("read", "events", [])).toEqual({
      command: "read",
      kind: "events",
      data: null,
      events: [],
      error: null,
    });
  });

  test("wraps slash text without guessing or decoding its contents", () => {
    expect(
      decodeReply("send", "slash", ["[guild] No roster", '{"text":"raw"}']),
    ).toEqual({
      command: "send",
      kind: "result",
      data: { lines: ["[guild] No roster", '{"text":"raw"}'] },
      events: [],
      error: null,
    });
  });

  test("rejects a missing intent acknowledgment", () => {
    expect(decodeReply("send", "intent", [])).toMatchObject({
      command: "send",
      kind: "error",
      data: null,
      events: [],
      error: { stage: "command" },
    });
  });

  test("rejects a non-acknowledgment intent reply", () => {
    expect(decodeReply("fight", "intent", ["CONNECTED"])).toMatchObject({
      command: "fight",
      kind: "error",
      error: { stage: "command" },
    });
  });

  test("rejects extra JSON documents instead of silently dropping them", () => {
    expect(decodeReply("who", "json", ["{}", "{}"])).toMatchObject({
      command: "who",
      kind: "error",
      error: { stage: "command" },
    });
  });

  test("reports malformed JSON as a command error", () => {
    expect(decodeReply("who", "json", ['{"players":'])).toMatchObject({
      command: "who",
      kind: "error",
      data: null,
      events: [],
      error: { stage: "command" },
    });
  });

  test("rejects malformed nearby JSON atomically", () => {
    expect(
      decodeReply("nearby", "nearby", ['{"guid":"0x1"}', "{"]),
    ).toMatchObject({
      command: "nearby",
      kind: "error",
      data: null,
      events: [],
      error: { stage: "command" },
    });
  });

  test.each([
    "null",
    "42",
    "[]",
  ] as const)("rejects a non-object event %s", (line) => {
    expect(decodeReply("read", "events", [line])).toMatchObject({
      command: "read",
      kind: "error",
      data: null,
      events: [],
      error: { stage: "command" },
    });
  });
});

describe("envelope constructors", () => {
  test("retains an acknowledged send when the later wait fails", () => {
    const acknowledged = decodeReply("send", "intent", ["OK"]);
    expect(
      errorEnvelope("send", "wait", "connection lost", acknowledged),
    ).toEqual({
      command: "send",
      kind: "intent",
      data: null,
      events: [],
      error: { stage: "wait", message: "connection lost" },
    });
  });

  test("retains prior data and events when a later wait fails", () => {
    const previous = {
      command: "send",
      kind: "result" as const,
      data: { lines: ["joined"] },
      events: [{ type: "SAY", message: "hi" }],
      error: null,
    };
    expect(errorEnvelope("send", "wait", "connection lost", previous)).toEqual({
      command: "send",
      kind: "result",
      data: { lines: ["joined"] },
      events: [{ type: "SAY", message: "hi" }],
      error: { stage: "wait", message: "connection lost" },
    });
  });
});

describe("daemonCommandFailed", () => {
  test("OK is success", () => {
    expect(daemonCommandFailed(["OK"])).toBe(false);
  });

  test("ERR fails the consumer", () => {
    expect(daemonCommandFailed(["ERR rooted"])).toBe(true);
  });
});

test("a directed walk exits unsuccessfully on a stop or missing outcome", () => {
  expect(walkCommandFailed(['{"status":"completed","traveled":2}'])).toBe(
    false,
  );
  expect(
    walkCommandFailed(['{"status":"stopped","reason":"obstructed"}']),
  ).toBe(true);
  expect(walkCommandFailed([])).toBe(true);
  expect(walkCommandFailed(["ERR target_not_observed"])).toBe(true);
});

describe("formatHumanIntent", () => {
  test("explains that an OK from an action is not a server result", () => {
    expect(formatHumanIntent("open-loot", ["OK"])).toEqual([
      "Daemon accepted request. Check tuicraft loot for observed results.",
    ]);
    expect(formatHumanIntent("cycle", ["ERR unsafe"])).toEqual(["ERR unsafe"]);
  });

  test("reports that fight and cycle ended, since they reply at the end", () => {
    expect(formatHumanIntent("fight", ["OK"])).toEqual([
      "The fight run ended. Check tuicraft tactics for its outcome.",
    ]);
    expect(formatHumanIntent("cycle", ["OK"])).toEqual([
      "The cycle run ended. Check tuicraft cycling for its outcome.",
    ]);
  });
});
