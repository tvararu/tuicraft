import { describe, expect, test } from "bun:test";
import {
  daemonCommandFailed,
  decodeReply,
  errorEnvelope,
  formatHumanIntent,
  walkCommandFailed,
} from "cli/send-output";

describe("decodeReply", () => {
  test.each(["OK", "OK WHISPER Aria"])(
    "treats %s as an intent acknowledgment",
    (line) => {
      expect(decodeReply("send", "intent", [line])).toEqual({
        command: "send",
        data: null,
        error: null,
        events: [],
        kind: "intent",
      });
    },
  );

  test("treats a slash OK reply as an intent", () => {
    expect(decodeReply("send", "slash", ["OK"])).toEqual({
      command: "send",
      data: null,
      error: null,
      events: [],
      kind: "intent",
    });
  });

  test("reports ERR instead of fabricated chat success", () => {
    expect(decodeReply("send", "intent", ["ERR rooted"])).toEqual({
      command: "send",
      data: null,
      error: { message: "rooted", stage: "command" },
      events: [],
      kind: "error",
    });
  });

  test("reports UNIMPLEMENTED before slash text", () => {
    expect(
      decodeReply("send", "slash", ["UNIMPLEMENTED Mail reading"]),
    ).toEqual({
      command: "send",
      data: null,
      error: { message: "Mail reading", stage: "command" },
      events: [],
      kind: "error",
    });
  });

  test("prioritizes daemon errors over event objects", () => {
    expect(
      decodeReply("read", "events", ['{"type":"SAY"}', "ERR read failed"]),
    ).toEqual({
      command: "read",
      data: null,
      error: { message: "read failed", stage: "command" },
      events: [],
      kind: "error",
    });
  });

  test("keeps a single JSON object as result data", () => {
    expect(
      decodeReply("who", "json", ['{"players":[{"name":"Aria"}]}']),
    ).toEqual({
      command: "who",
      data: { players: [{ name: "Aria" }] },
      error: null,
      events: [],
      kind: "result",
    });
  });

  test("keeps a single JSON array as result data", () => {
    expect(decodeReply("spells", "json", ['[{"id":5},9]'])).toEqual({
      command: "spells",
      data: [{ id: 5 }, 9],
      error: null,
      events: [],
      kind: "result",
    });
  });

  test("collects multiple nearby objects in result data", () => {
    expect(
      decodeReply("nearby", "nearby", ['{"guid":"0x1"}', '{"guid":"0x2"}']),
    ).toEqual({
      command: "nearby",
      data: [{ guid: "0x1" }, { guid: "0x2" }],
      error: null,
      events: [],
      kind: "result",
    });
  });

  test("returns an empty result for an empty nearby reply", () => {
    expect(decodeReply("nearby", "nearby", [])).toEqual({
      command: "nearby",
      data: [],
      error: null,
      events: [],
      kind: "result",
    });
  });

  test("rejects a non-object nearby entry", () => {
    expect(
      decodeReply("nearby", "nearby", ['{"guid":"0x1"}', "7"]),
    ).toMatchObject({
      command: "nearby",
      data: null,
      error: { stage: "command" },
      events: [],
      kind: "error",
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
      data: null,
      error: null,
      events: [
        { message: "hi", type: "SAY" },
        { message: "bye", type: "WHISPER" },
      ],
      kind: "events",
    });
  });

  test("returns an empty event envelope for an empty read", () => {
    expect(decodeReply("read", "events", [])).toEqual({
      command: "read",
      data: null,
      error: null,
      events: [],
      kind: "events",
    });
  });

  test("wraps slash text without guessing or decoding its contents", () => {
    expect(
      decodeReply("send", "slash", ["[guild] No roster", '{"text":"raw"}']),
    ).toEqual({
      command: "send",
      data: { lines: ["[guild] No roster", '{"text":"raw"}'] },
      error: null,
      events: [],
      kind: "result",
    });
  });

  test("rejects a missing intent acknowledgment", () => {
    expect(decodeReply("send", "intent", [])).toMatchObject({
      command: "send",
      data: null,
      error: { stage: "command" },
      events: [],
      kind: "error",
    });
  });

  test("rejects a non-acknowledgment intent reply", () => {
    expect(decodeReply("fight", "intent", ["CONNECTED"])).toMatchObject({
      command: "fight",
      error: { stage: "command" },
      kind: "error",
    });
  });

  test("rejects extra JSON documents instead of silently dropping them", () => {
    expect(decodeReply("who", "json", ["{}", "{}"])).toMatchObject({
      command: "who",
      error: { stage: "command" },
      kind: "error",
    });
  });

  test("reports malformed JSON as a command error", () => {
    expect(decodeReply("who", "json", ['{"players":'])).toMatchObject({
      command: "who",
      data: null,
      error: { stage: "command" },
      events: [],
      kind: "error",
    });
  });

  test("rejects malformed nearby JSON atomically", () => {
    expect(
      decodeReply("nearby", "nearby", ['{"guid":"0x1"}', "{"]),
    ).toMatchObject({
      command: "nearby",
      data: null,
      error: { stage: "command" },
      events: [],
      kind: "error",
    });
  });

  test.each(["null", "42", "[]"] as const)(
    "rejects a non-object event %s",
    (line) => {
      expect(decodeReply("read", "events", [line])).toMatchObject({
        command: "read",
        data: null,
        error: { stage: "command" },
        events: [],
        kind: "error",
      });
    },
  );
});

describe("envelope constructors", () => {
  test("retains an acknowledged send when the later wait fails", () => {
    const acknowledged = decodeReply("send", "intent", ["OK"]);
    expect(
      errorEnvelope("send", "wait", "connection lost", acknowledged),
    ).toEqual({
      command: "send",
      data: null,
      error: { message: "connection lost", stage: "wait" },
      events: [],
      kind: "intent",
    });
  });

  test("retains prior data and events when a later wait fails", () => {
    const previous = {
      command: "send",
      data: { lines: ["joined"] },
      error: null,
      events: [{ message: "hi", type: "SAY" }],
      kind: "result" as const,
    };
    expect(errorEnvelope("send", "wait", "connection lost", previous)).toEqual({
      command: "send",
      data: { lines: ["joined"] },
      error: { message: "connection lost", stage: "wait" },
      events: [{ message: "hi", type: "SAY" }],
      kind: "result",
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
