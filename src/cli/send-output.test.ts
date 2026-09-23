import { describe, expect, test } from "bun:test";
import {
  daemonCommandFailed,
  walkCommandFailed,
  decodeReply,
  errorEnvelope,
  formatHumanInspection,
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

describe("human gameplay output", () => {
  test("shows observed kill credit and coinage instead of treating loot intent as gain", () => {
    const output = formatHumanInspection("cycling", {
      phase: "stopped",
      startsUsed: 1,
      maxStarts: 1,
      stopCause: "queue_exhausted",
      queue: [
        {
          guid: "0xf130003f220576e9",
          status: "done",
          outcome: {
            status: "completed",
            reason: "server_kill_credit",
            observation: {
              lastXp: { victim: "0xf130003f220576e9", total: 84, kind: "kill" },
            },
          },
        },
      ],
      lastLoot: {
        slotsTaken: [],
        moneyTaken: 5,
        coinageBefore: 6174,
        coinageAfter: 6179,
      },
    }).join("\n");

    expect(output).toContain("84 XP");
    expect(output).toContain("6174 -> 6179");
    expect(output).toContain("queue_exhausted");
    expect(output).not.toContain("item gained");
  });

  test("does not attribute stale XP to another target", () => {
    const output = formatHumanInspection("cycling", {
      phase: "stopped",
      startsUsed: 1,
      maxStarts: 1,
      queue: [
        {
          guid: "0xf130003f220576e9",
          status: "done",
          outcome: {
            reason: "server_kill_credit",
            observation: {
              lastXp: { victim: "0xf130003f22000001", total: 84, kind: "kill" },
            },
          },
        },
      ],
    }).join("\n");

    expect(output).toContain("server_kill_credit");
    expect(output).not.toContain("84 XP");
  });

  test("does not report gained money when the take lacks a coinage observation", () => {
    const output = formatHumanInspection("cycling", {
      phase: "stopped",
      startsUsed: 1,
      maxStarts: 1,
      queue: [],
      lastLoot: { slotsTaken: [0], moneyTaken: 10, coinageBefore: 6174 },
    }).join("\n");

    expect(output).toContain("10 copper requested");
    expect(output).toContain("Coinage change: unknown");
    expect(output).toContain("Item slots requested: 0");
    expect(output).not.toContain("item gained");
  });

  test("shows recovery blockers without interpreting a pending request as resurrection", () => {
    const output = formatHumanInspection("recovery", {
      life: "ghost",
      health: 202,
      epoch: 2,
      corpse: { status: "found", mapId: 530, corpseMapId: 530 },
      reclaim: {
        canRequest: false,
        readiness: "blocked",
        reason: "corpse_out_of_range",
        distance: 184.15,
      },
      request: { action: "spirit-healer", status: "unanswered" },
    }).join("\n");

    expect(output).toContain("Life: ghost");
    expect(output).toContain("corpse_out_of_range");
    expect(output).toContain("184.15");
    expect(output).toContain("spirit-healer unanswered");
    expect(output).not.toContain("Life: alive");
    expect(output).toContain("Reclaim request allowed: no");
  });
  test("keeps missing reclaim permission unknown", () => {
    const output = formatHumanInspection("recovery", {
      life: "ghost",
      reclaim: { readiness: "unverified" },
    }).join("\n");

    expect(output).toContain("Reclaim request allowed: unknown");
  });

  test("shows unanswered opening without claiming a loot denial", () => {
    const output = formatHumanInspection("loot", {
      loot: { phase: "opening", guid: "0xf130003f220576e9" },
      pending: { action: "open", status: "unanswered" },
      inventory: { status: "complete", coinage: 6174 },
    }).join("\n");

    expect(output).toContain("opening");
    expect(output).toContain("open unanswered");
    expect(output).not.toContain("denied");
  });
  test("labels offered loot slots that allow direct pickup", () => {
    const output = formatHumanInspection("loot", {
      loot: {
        phase: "open",
        money: 10,
        items: [
          { slot: 0, itemId: 27668, count: 2, slotType: 0 },
          { slot: 1, itemId: 20772, count: 1, slotType: 2 },
          { slot: 2, itemId: 27668, count: 1 },
        ],
      },
      inventory: { coinage: 6174 },
    }).join("\n");

    expect(output).toContain("Slot 0: item 27668 x2 (pickup allowed)");
    expect(output).toContain("Slot 1: item 20772 x1 (no direct pickup)");
    expect(output).toContain(
      "Slot 2: item 27668 x1 (pickup permission unknown)",
    );
    expect(output).toContain("Offer: 10 copper");
  });

  test("labels past loot and inventory errors without raw JSON", () => {
    const output = formatHumanInspection("loot", {
      loot: { phase: "closed" },
      inventory: { coinage: 6179 },
      lastInventoryError: {
        packet: { kind: "error", result: 49 },
        inventoryFull: true,
        bagFull: false,
      },
      lastLootError: { error: 4 },
    }).join("\n");

    expect(output).toContain("Last inventory error: inventory full");
    expect(output).toContain("Last loot error code: 4");
    expect(output).not.toContain('{"packet"');
  });

  test("shows item counts and preserves unknown inventory values", () => {
    const output = formatHumanInspection("inventory", {
      status: "partial",
      coinage: null,
      freeSlots: null,
      slots: [
        {
          bag: 20,
          slot: 16,
          status: "occupied",
          item: { entry: 27668, count: 12 },
        },
        { bag: 20, slot: 17, status: "unknown" },
      ],
      issues: [],
    }).join("\n");

    expect(output).toContain("partial");
    expect(output).toContain("Coinage: unknown");
    expect(output).toContain("Free slots: unknown");
    expect(output).toContain("27668 x12");
    expect(output).toContain("Unknown slots: 1");
  });

  test("explains that an OK from an action is not a server result", () => {
    expect(formatHumanIntent("cycle", ["OK"]).join("\n")).toContain(
      "Check tuicraft cycling",
    );
    expect(formatHumanIntent("cycle", ["OK"]).join("\n")).toContain(
      "Daemon accepted request",
    );
    expect(formatHumanIntent("cycle", ["ERR unsafe"])).toEqual(["ERR unsafe"]);
  });
});
