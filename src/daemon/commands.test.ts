import { test, expect, describe, jest, afterEach } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import {
  parseIpcCommand,
  dispatchCommand,
  onChatMessage,
  onGroupEvent,
  onEntityEvent,
  onFriendEvent,
  onIgnoreEvent,
  onGuildEvent,
  onDuelEvent,
  onControlEvent,
  onCycleEvent,
  writeLines,
  type EventEntry,
} from "daemon/commands";
import { startDaemonServer } from "daemon/server";
import { sendToSocket } from "cli/ipc";
import { RingBuffer } from "lib/ring-buffer";
import { ChatType } from "wow/protocol/opcodes";
import { FriendStatus } from "wow/protocol/social";
import { ObjectType } from "wow/protocol/entity-fields";
import type {
  UnitEntity,
  GameObjectEntity,
  BaseEntity,
} from "wow/entity-store";
import { SessionLog } from "lib/session-log";
import { createMockHandle } from "test/mock-handle";
import type { ControlEvent, ControlState } from "wow/control";
import type { FollowState } from "wow/follow";
import type { CycleState } from "wow/encounter-cycle";

function createMockSocket(): {
  write: ReturnType<typeof jest.fn>;
  end: ReturnType<typeof jest.fn>;
  written(): string;
} {
  const chunks: string[] = [];
  return {
    write: jest.fn((data: string | Uint8Array) => {
      chunks.push(
        typeof data === "string" ? data : Buffer.from(data).toString(),
      );
      return (typeof data === "string" ? data : Buffer.from(data).toString())
        .length;
    }),
    end: jest.fn(),
    written() {
      return chunks.join("");
    },
  };
}

async function sendRawCommands(
  path: string,
  chunks: string[],
  gapMs = 0,
): Promise<string[]> {
  let buffer = "";
  return new Promise<string[]>((resolve, reject) => {
    Bun.connect({
      unix: path,
      socket: {
        async open(socket) {
          for (const [i, chunk] of chunks.entries()) {
            if (i > 0 && gapMs > 0) await Bun.sleep(gapMs);
            socket.write(chunk);
            socket.flush();
          }
        },
        data(socket, data) {
          buffer += Buffer.from(data).toString();
          if (buffer.endsWith("\n\n") || buffer === "\n") {
            socket.end();
            resolve(buffer.split("\n").filter((line) => line !== ""));
          }
        },
        close() {
          resolve(buffer.split("\n").filter((line) => line !== ""));
        },
        error(_socket, err) {
          reject(err);
        },
      },
    }).catch(reject);
  });
}

async function sendRawUntilClose(
  path: string,
  chunks: string[],
  gapMs = 0,
): Promise<string[]> {
  let buffer = "";
  return new Promise<string[]>((resolve, reject) => {
    Bun.connect({
      unix: path,
      socket: {
        async open(socket) {
          for (const [i, chunk] of chunks.entries()) {
            if (i > 0 && gapMs > 0) await Bun.sleep(gapMs);
            socket.write(chunk);
            socket.flush();
          }
        },
        data(_socket, data) {
          buffer += Buffer.from(data).toString();
        },
        close() {
          resolve(buffer.split("\n").filter((line) => line !== ""));
        },
        error(_socket, err) {
          reject(err);
        },
      },
    }).catch(reject);
  });
}

type ControlMock = ReturnType<typeof createMockHandle> & {
  getControlState: ReturnType<typeof jest.fn>;
  move: ReturnType<typeof jest.fn>;
  face: ReturnType<typeof jest.fn>;
  selectTarget: ReturnType<typeof jest.fn>;
  halt: ReturnType<typeof jest.fn>;
  onControlEvent: ReturnType<typeof jest.fn>;
  getCombatState: ReturnType<typeof jest.fn>;
  getSpellbook: ReturnType<typeof jest.fn>;
  cast: ReturnType<typeof jest.fn>;
  attack: ReturnType<typeof jest.fn>;
  cancelCast: ReturnType<typeof jest.fn>;
  stopAttack: ReturnType<typeof jest.fn>;
  startTactics: ReturnType<typeof jest.fn>;
  getTacticsState: ReturnType<typeof jest.fn>;
  goTo: ReturnType<typeof jest.fn>;
  getNavigationState: ReturnType<typeof jest.fn>;
  onCombatEvent: ReturnType<typeof jest.fn>;
  onTacticsEvent: ReturnType<typeof jest.fn>;
};

function attachControl(
  handle: ReturnType<typeof createMockHandle>,
): ControlMock {
  Object.assign(handle, {
    getControlState: jest.fn(
      (): ControlState => ({
        selfGuid: 1n,
        pose: undefined,
        serverPose: undefined,
        target: undefined,
        requestedTarget: undefined,
        moving: false,
        direction: undefined,
        movementAllowed: true,
        blockedReason: undefined,
        speed: 0,
        owner: "none",
      }),
    ),
    move: jest.fn(),
    face: jest.fn(),
    selectTarget: jest.fn(),
    halt: jest.fn(),
    onControlEvent: jest.fn(),
    getCombatState: jest.fn(() => ({})),
    getSpellbook: jest.fn(async () => []),
    cast: jest.fn(),
    attack: jest.fn(),
    cancelCast: jest.fn(),
    stopAttack: jest.fn(),
    startTactics: jest.fn(async () => {}),
    getTacticsState: jest.fn(() => ({})),
    goTo: jest.fn(),
    getNavigationState: jest.fn(() => ({})),
    onCombatEvent: jest.fn(),
    onTacticsEvent: jest.fn(),
  });
  return handle as ControlMock;
}

function sampleState(overrides: Partial<ControlState> = {}): ControlState {
  return {
    selfGuid: 0xabcden,
    pose: {
      mapId: 530,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
      orientation: 1.5,
      source: "predicted",
      updatedAt: 1000,
    },
    serverPose: {
      mapId: 530,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
      orientation: 1.57,
      source: "server",
      updatedAt: 900,
    },
    target: 0xan,
    requestedTarget: 0xan,
    moving: true,
    direction: "forward",
    movementAllowed: true,
    blockedReason: undefined,
    speed: 7,
    owner: "manual",
    ...overrides,
  };
}

describe("parseIpcCommand", () => {
  test("SAY", () => {
    expect(parseIpcCommand("SAY hello world")).toEqual({
      type: "say",
      message: "hello world",
    });
  });

  test("YELL", () => {
    expect(parseIpcCommand("YELL hey everyone")).toEqual({
      type: "yell",
      message: "hey everyone",
    });
  });

  test("GUILD", () => {
    expect(parseIpcCommand("GUILD inv pls")).toEqual({
      type: "guild",
      message: "inv pls",
    });
  });

  test("PARTY", () => {
    expect(parseIpcCommand("PARTY pull now")).toEqual({
      type: "party",
      message: "pull now",
    });
  });

  test("EMOTE", () => {
    expect(parseIpcCommand("EMOTE waves hello")).toEqual({
      type: "emote",
      message: "waves hello",
    });
  });

  test("DND", () => {
    expect(parseIpcCommand("DND busy right now")).toEqual({
      type: "dnd",
      message: "busy right now",
    });
  });

  test("DND without message", () => {
    expect(parseIpcCommand("DND")).toEqual({
      type: "dnd",
      message: "",
    });
  });

  test("AFK", () => {
    expect(parseIpcCommand("AFK grabbing coffee")).toEqual({
      type: "afk",
      message: "grabbing coffee",
    });
  });

  test("AFK without message", () => {
    expect(parseIpcCommand("AFK")).toEqual({
      type: "afk",
      message: "",
    });
  });

  test("ROLL defaults to 1-100", () => {
    expect(parseIpcCommand("ROLL")).toEqual({
      type: "roll",
      min: 1,
      max: 100,
    });
  });

  test("ROLL with max", () => {
    expect(parseIpcCommand("ROLL 50")).toEqual({
      type: "roll",
      min: 1,
      max: 50,
    });
  });

  test("ROLL with min and max", () => {
    expect(parseIpcCommand("ROLL 10 20")).toEqual({
      type: "roll",
      min: 10,
      max: 20,
    });
  });

  test("/roll via slash style", () => {
    expect(parseIpcCommand("/roll 50")).toEqual({
      type: "roll",
      min: 1,
      max: 50,
    });
  });

  test("WHISPER", () => {
    expect(parseIpcCommand("WHISPER Xiara follow me")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "follow me",
    });
  });

  test("WHISPER without message", () => {
    expect(parseIpcCommand("WHISPER Xiara")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "",
    });
  });

  test("READ", () => {
    expect(parseIpcCommand("READ")).toEqual({ type: "read" });
  });

  test("READ_WAIT", () => {
    expect(parseIpcCommand("READ_WAIT 3000")).toEqual({
      type: "read_wait",
      ms: 3000,
    });
  });

  test("STOP", () => {
    expect(parseIpcCommand("STOP")).toEqual({ type: "stop" });
  });

  test("STATUS", () => {
    expect(parseIpcCommand("STATUS")).toEqual({ type: "status" });
  });

  test("WHO without filter", () => {
    expect(parseIpcCommand("WHO")).toEqual({ type: "who" });
  });

  test("WHO with filter", () => {
    expect(parseIpcCommand("WHO mage")).toEqual({
      type: "who",
      filter: "mage",
    });
  });

  test("READ_JSON", () => {
    expect(parseIpcCommand("READ_JSON")).toEqual({ type: "read_json" });
  });

  test("READ_WAIT_JSON", () => {
    expect(parseIpcCommand("READ_WAIT_JSON 2000")).toEqual({
      type: "read_wait_json",
      ms: 2000,
    });
  });

  test("WHO_JSON without filter", () => {
    expect(parseIpcCommand("WHO_JSON")).toEqual({ type: "who_json" });
  });

  test("WHO_JSON with filter", () => {
    expect(parseIpcCommand("WHO_JSON mage")).toEqual({
      type: "who_json",
      filter: "mage",
    });
  });

  test("INVITE", () => {
    expect(parseIpcCommand("INVITE Voidtrix")).toEqual({
      type: "invite",
      target: "Voidtrix",
    });
  });

  test("KICK", () => {
    expect(parseIpcCommand("KICK Voidtrix")).toEqual({
      type: "kick",
      target: "Voidtrix",
    });
  });

  test("LEAVE", () => {
    expect(parseIpcCommand("LEAVE")).toEqual({ type: "leave" });
  });

  test("LEADER", () => {
    expect(parseIpcCommand("LEADER Voidtrix")).toEqual({
      type: "leader",
      target: "Voidtrix",
    });
  });

  test("ACCEPT", () => {
    expect(parseIpcCommand("ACCEPT")).toEqual({ type: "accept" });
  });

  test("DECLINE", () => {
    expect(parseIpcCommand("DECLINE")).toEqual({ type: "decline" });
  });

  test("NEARBY", () => {
    expect(parseIpcCommand("NEARBY")).toEqual({ type: "nearby" });
  });

  test("NEARBY_JSON", () => {
    expect(parseIpcCommand("NEARBY_JSON")).toEqual({ type: "nearby_json" });
  });

  test("NEARBY all and NEARBY_JSON all", () => {
    expect(parseIpcCommand("NEARBY all")).toEqual({
      type: "nearby",
      all: true,
    });
    expect(parseIpcCommand("NEARBY_JSON all")).toEqual({
      type: "nearby_json",
      all: true,
    });
  });

  test("CONTROL and CONTROL_JSON", () => {
    expect(parseIpcCommand("CONTROL")).toEqual({ type: "control" });
    expect(parseIpcCommand("CONTROL_JSON")).toEqual({ type: "control_json" });
  });

  test("MOVE defaults to 1000ms", () => {
    expect(parseIpcCommand("MOVE forward")).toEqual({
      type: "move",
      direction: "forward",
      durationMs: 1000,
    });
  });

  test("MOVE accepts duration bounds", () => {
    expect(parseIpcCommand("MOVE backward 1")).toEqual({
      type: "move",
      direction: "backward",
      durationMs: 1,
    });
    expect(parseIpcCommand("MOVE left 10000")).toEqual({
      type: "move",
      direction: "left",
      durationMs: 10000,
    });
  });

  test("MOVE rejects malformed and out-of-range args", () => {
    expect(parseIpcCommand("MOVE")).toEqual({
      type: "invalid",
      reason: "invalid move",
    });
    expect(parseIpcCommand("MOVE up")).toEqual({
      type: "invalid",
      reason: "invalid direction",
    });
    expect(parseIpcCommand("MOVE forward 0")).toEqual({
      type: "invalid",
      reason: "invalid duration",
    });
    expect(parseIpcCommand("MOVE forward 10001")).toEqual({
      type: "invalid",
      reason: "invalid duration",
    });
    expect(parseIpcCommand("MOVE forward 1.5")).toEqual({
      type: "invalid",
      reason: "invalid duration",
    });
    expect(parseIpcCommand("MOVE forward Infinity")).toEqual({
      type: "invalid",
      reason: "invalid duration",
    });
  });

  test("FACE accepts finite radians", () => {
    expect(parseIpcCommand("FACE 1.57")).toEqual({
      type: "face",
      orientation: 1.57,
    });
    expect(parseIpcCommand("FACE 0")).toEqual({
      type: "face",
      orientation: 0,
    });
  });

  test("FACE rejects nonfinite and missing", () => {
    expect(parseIpcCommand("FACE")?.type).toBe("invalid");
    expect(parseIpcCommand("FACE NaN")?.type).toBe("invalid");
    expect(parseIpcCommand("FACE Infinity")?.type).toBe("invalid");
    expect(parseIpcCommand("FACE 1 2")?.type).toBe("invalid");
  });

  test("TARGET accepts hex and decimal uint64", () => {
    expect(parseIpcCommand("TARGET 0x1")).toEqual({ type: "target", guid: 1n });
    expect(parseIpcCommand("TARGET 0")).toEqual({ type: "target", guid: 0n });
    expect(parseIpcCommand("TARGET 18446744073709551615")).toEqual({
      type: "target",
      guid: 0xffff_ffff_ffff_ffffn,
    });
  });

  test("TARGET rejects malformed guid", () => {
    expect(parseIpcCommand("TARGET")?.type).toBe("invalid");
    expect(parseIpcCommand("TARGET -1")?.type).toBe("invalid");
    expect(parseIpcCommand("TARGET 0x")?.type).toBe("invalid");
    expect(parseIpcCommand("TARGET 18446744073709551616")?.type).toBe(
      "invalid",
    );
  });

  test("HALT", () => {
    expect(parseIpcCommand("HALT")).toEqual({ type: "halt" });
  });

  test("CAST ATTACK FIGHT GOTO parse exact arity", () => {
    expect(parseIpcCommand("CAST 585 0xa")).toEqual({
      type: "cast",
      spellId: 585,
      guid: 0xan,
    });
    expect(parseIpcCommand("ATTACK 0xa")).toEqual({
      type: "attack",
      guid: 0xan,
    });
    expect(parseIpcCommand("FIGHT 0xa")).toEqual({
      type: "fight",
      guid: 0xan,
      instruction:
        "defeat the selected target while keeping the character alive",
    });
    expect(parseIpcCommand("FIGHT 0xa hold threat")).toEqual({
      type: "fight",
      guid: 0xan,
      instruction: "hold threat",
    });
    expect(parseIpcCommand("FIGHT --framing minimal 0xa")).toEqual({
      type: "fight",
      guid: 0xan,
      instruction:
        "defeat the selected target while keeping the character alive",
      framing: "minimal",
    });
    expect(
      parseIpcCommand("FIGHT --framing=mechanics 0xa conserve mana"),
    ).toEqual({
      type: "fight",
      guid: 0xan,
      instruction: "conserve mana",
      framing: "mechanics",
    });
    expect(parseIpcCommand("FIGHT --framing invalid 0xa")?.type).toBe(
      "invalid",
    );
    expect(parseIpcCommand("FIGHT --framing")?.type).toBe("invalid");
    expect(parseIpcCommand("CYCLE 0xa 0xb")).toEqual({
      type: "cycle",
      guids: [0xan, 0xbn],
      instruction:
        "defeat the selected target while keeping the character alive",
      maxStarts: 10,
    });
    expect(parseIpcCommand("CYCLE 0xa --max 3")).toEqual({
      type: "cycle",
      guids: [0xan],
      instruction:
        "defeat the selected target while keeping the character alive",
      maxStarts: 3,
    });
    expect(
      parseIpcCommand("CYCLE 0xa 0xb --instruction hold aggro --max 5"),
    ).toEqual({
      type: "cycle",
      guids: [0xan, 0xbn],
      instruction: "hold aggro",
      maxStarts: 5,
    });
    expect(parseIpcCommand("CYCLE")?.type).toBe("invalid");
    expect(parseIpcCommand("CYCLE 0")?.type).toBe("invalid");
    expect(parseIpcCommand("CYCLE 0xa --max 0")?.type).toBe("invalid");
    expect(parseIpcCommand("CYCLING")).toEqual({ type: "cycling" });
    expect(parseIpcCommand("CYCLING_JSON")).toEqual({
      type: "cycling_json",
    });
    expect(parseIpcCommand("GOTO 1 2 3")).toEqual({
      type: "goto",
      x: 1,
      y: 2,
      z: 3,
    });
    expect(parseIpcCommand("CAST")?.type).toBe("invalid");
    expect(parseIpcCommand("CAST 0 0x1")?.type).toBe("invalid");
    expect(parseIpcCommand("GOTO 1 2")?.type).toBe("invalid");
    expect(parseIpcCommand("GOTO 1 2 Infinity")?.type).toBe("invalid");
    expect(parseIpcCommand("COMBAT")).toEqual({ type: "combat" });
    expect(parseIpcCommand("SPELLS_JSON")).toEqual({ type: "spells_json" });
  });

  test("slash /accept maps to accept", () => {
    expect(parseIpcCommand("/accept")).toEqual({ type: "accept" });
  });

  test("slash /say maps to say", () => {
    expect(parseIpcCommand("/say hello")).toEqual({
      type: "say",
      message: "hello",
    });
  });

  test("slash /whisper maps to whisper", () => {
    expect(parseIpcCommand("/whisper Xiara hi")).toEqual({
      type: "whisper",
      target: "Xiara",
      message: "hi",
    });
  });

  test("slash /emote maps to emote", () => {
    expect(parseIpcCommand("/emote waves")).toEqual({
      type: "emote",
      message: "waves",
    });
  });

  test("slash /dnd maps to dnd", () => {
    expect(parseIpcCommand("/dnd busy")).toEqual({
      type: "dnd",
      message: "busy",
    });
  });

  test("slash /afk maps to afk", () => {
    expect(parseIpcCommand("/afk brb")).toEqual({
      type: "afk",
      message: "brb",
    });
  });

  test("slash /who maps to who with filter", () => {
    expect(parseIpcCommand("/who mage")).toEqual({
      type: "who",
      filter: "mage",
    });
  });

  test("slash /who maps to who without filter", () => {
    expect(parseIpcCommand("/who")).toEqual({ type: "who" });
  });

  test("slash /invite maps to invite", () => {
    expect(parseIpcCommand("/invite Voidtrix")).toEqual({
      type: "invite",
      target: "Voidtrix",
    });
  });

  test("slash /kick maps to kick", () => {
    expect(parseIpcCommand("/kick Voidtrix")).toEqual({
      type: "kick",
      target: "Voidtrix",
    });
  });

  test("slash /leave maps to leave", () => {
    expect(parseIpcCommand("/leave")).toEqual({ type: "leave" });
  });

  test("slash /friends maps to friends", () => {
    expect(parseIpcCommand("/friends")).toEqual({ type: "friends" });
  });

  test("slash /ignore maps to add_ignore", () => {
    expect(parseIpcCommand("/ignore someone")).toEqual({
      type: "add_ignore",
      target: "someone",
    });
  });

  test("slash /ignore bare maps to ignored", () => {
    expect(parseIpcCommand("/ignore")).toEqual({ type: "ignored" });
  });

  test("slash /ignorelist maps to ignored", () => {
    expect(parseIpcCommand("/ignorelist")).toEqual({ type: "ignored" });
  });

  test("slash /unignore maps to del_ignore", () => {
    expect(parseIpcCommand("/unignore someone")).toEqual({
      type: "del_ignore",
      target: "someone",
    });
  });

  test("slash /join maps to join_channel", () => {
    expect(parseIpcCommand("/join Trade")).toEqual({
      type: "join_channel",
      channel: "Trade",
    });
  });

  test("slash /leave channel maps to leave_channel", () => {
    expect(parseIpcCommand("/leave Trade")).toEqual({
      type: "leave_channel",
      channel: "Trade",
    });
  });

  test("unknown slash command maps to say with full input", () => {
    expect(parseIpcCommand("/dance hello")).toEqual({
      type: "say",
      message: "/dance hello",
    });
  });

  test("slash command unsupported by daemon falls back to say", () => {
    expect(parseIpcCommand("/r hello")).toEqual({
      type: "say",
      message: "/r hello",
    });
  });

  test("INVITE with no target returns undefined", () => {
    expect(parseIpcCommand("INVITE")).toBeUndefined();
  });

  test("KICK with no target returns undefined", () => {
    expect(parseIpcCommand("KICK")).toBeUndefined();
  });

  test("LEADER with no target returns undefined", () => {
    expect(parseIpcCommand("LEADER")).toBeUndefined();
  });

  test("JOIN parses channel", () => {
    expect(parseIpcCommand("JOIN Trade")).toEqual({
      type: "join_channel",
      channel: "Trade",
    });
  });

  test("JOIN parses channel with password", () => {
    expect(parseIpcCommand("JOIN Secret hunter2")).toEqual({
      type: "join_channel",
      channel: "Secret",
      password: "hunter2",
    });
  });

  test("JOIN with no channel returns undefined", () => {
    expect(parseIpcCommand("JOIN")).toBeUndefined();
  });

  test("LEAVE with channel parses leave_channel", () => {
    expect(parseIpcCommand("LEAVE Trade")).toEqual({
      type: "leave_channel",
      channel: "Trade",
    });
  });

  test("LEAVE without channel parses leave", () => {
    expect(parseIpcCommand("LEAVE")).toEqual({ type: "leave" });
  });

  describe("unimplemented IPC commands", () => {
    const cases = [["MAIL", "Mail reading"]] as const;

    for (const [input, feature] of cases) {
      test(`${input.split(" ")[0]} returns unimplemented`, () => {
        expect(parseIpcCommand(input)).toEqual({
          type: "unimplemented",
          feature,
        });
      });
    }

    test("/mail slash path returns unimplemented", () => {
      expect(parseIpcCommand("/mail")).toEqual({
        type: "unimplemented",
        feature: "Mail reading",
      });
    });
  });

  test("unrecognized verb becomes chat", () => {
    expect(parseIpcCommand("DANCE")).toEqual({
      type: "chat",
      message: "DANCE",
    });
  });

  test("unrecognized text becomes chat command", () => {
    expect(parseIpcCommand("hello world")).toEqual({
      type: "chat",
      message: "hello world",
    });
  });

  test("single word becomes chat command", () => {
    expect(parseIpcCommand("hello")).toEqual({
      type: "chat",
      message: "hello",
    });
  });

  test("empty string returns undefined", () => {
    expect(parseIpcCommand("")).toBeUndefined();
  });

  test("READ_WAIT with empty argument returns undefined", () => {
    expect(parseIpcCommand("READ_WAIT")).toBeUndefined();
  });

  test("READ_WAIT with non-numeric argument returns undefined", () => {
    expect(parseIpcCommand("READ_WAIT abc")).toBeUndefined();
  });

  test("READ_WAIT with negative value returns undefined", () => {
    expect(parseIpcCommand("READ_WAIT -100")).toBeUndefined();
  });

  test("READ_WAIT clamps to 60000ms", () => {
    expect(parseIpcCommand("READ_WAIT 120000")).toEqual({
      type: "read_wait",
      ms: 60_000,
    });
  });

  test("READ_WAIT_JSON with empty argument returns undefined", () => {
    expect(parseIpcCommand("READ_WAIT_JSON")).toBeUndefined();
  });

  test("READ_WAIT_JSON clamps to 60000ms", () => {
    expect(parseIpcCommand("READ_WAIT_JSON 999999")).toEqual({
      type: "read_wait_json",
      ms: 60_000,
    });
  });

  test("FRIENDS", () => {
    expect(parseIpcCommand("FRIENDS")).toEqual({ type: "friends" });
  });

  test("FRIENDS_JSON", () => {
    expect(parseIpcCommand("FRIENDS_JSON")).toEqual({ type: "friends_json" });
  });

  test("ADD_FRIEND", () => {
    expect(parseIpcCommand("ADD_FRIEND Arthas")).toEqual({
      type: "add_friend",
      target: "Arthas",
    });
  });

  test("ADD_FRIEND with no target returns undefined", () => {
    expect(parseIpcCommand("ADD_FRIEND")).toBeUndefined();
  });

  test("DEL_FRIEND", () => {
    expect(parseIpcCommand("DEL_FRIEND Arthas")).toEqual({
      type: "del_friend",
      target: "Arthas",
    });
  });

  test("DEL_FRIEND with no target returns undefined", () => {
    expect(parseIpcCommand("DEL_FRIEND")).toBeUndefined();
  });

  test("slash /friend add maps to add_friend", () => {
    expect(parseIpcCommand("/friend add Arthas")).toEqual({
      type: "add_friend",
      target: "Arthas",
    });
  });

  test("slash /friend remove maps to del_friend", () => {
    expect(parseIpcCommand("/friend remove Arthas")).toEqual({
      type: "del_friend",
      target: "Arthas",
    });
  });

  test("IGNORED", () => {
    expect(parseIpcCommand("IGNORED")).toEqual({ type: "ignored" });
  });

  test("IGNORED_JSON", () => {
    expect(parseIpcCommand("IGNORED_JSON")).toEqual({ type: "ignored_json" });
  });

  test("ADD_IGNORE", () => {
    expect(parseIpcCommand("ADD_IGNORE Spammer")).toEqual({
      type: "add_ignore",
      target: "Spammer",
    });
  });

  test("ADD_IGNORE with no target returns undefined", () => {
    expect(parseIpcCommand("ADD_IGNORE")).toBeUndefined();
  });

  test("DEL_IGNORE", () => {
    expect(parseIpcCommand("DEL_IGNORE Spammer")).toEqual({
      type: "del_ignore",
      target: "Spammer",
    });
  });

  test("DEL_IGNORE with no target returns undefined", () => {
    expect(parseIpcCommand("DEL_IGNORE")).toBeUndefined();
  });

  test("GUILD_ROSTER", () => {
    expect(parseIpcCommand("GUILD_ROSTER")).toEqual({ type: "guild_roster" });
  });

  test("GUILD_ROSTER_JSON", () => {
    expect(parseIpcCommand("GUILD_ROSTER_JSON")).toEqual({
      type: "guild_roster_json",
    });
  });

  test("/groster", () => {
    expect(parseIpcCommand("/groster")).toEqual({ type: "guild_roster" });
  });

  test("GINVITE parses guild invite", () => {
    expect(parseIpcCommand("GINVITE Thrall")).toEqual({
      type: "guild_invite",
      target: "Thrall",
    });
  });

  test("GINVITE without target returns undefined", () => {
    expect(parseIpcCommand("GINVITE")).toBeUndefined();
  });

  test("GKICK parses guild kick", () => {
    expect(parseIpcCommand("GKICK Garrosh")).toEqual({
      type: "guild_kick",
      target: "Garrosh",
    });
  });

  test("GLEAVE parses guild leave", () => {
    expect(parseIpcCommand("GLEAVE")).toEqual({ type: "guild_leave" });
  });

  test("GPROMOTE parses guild promote", () => {
    expect(parseIpcCommand("GPROMOTE Jaina")).toEqual({
      type: "guild_promote",
      target: "Jaina",
    });
  });

  test("GDEMOTE parses guild demote", () => {
    expect(parseIpcCommand("GDEMOTE Arthas")).toEqual({
      type: "guild_demote",
      target: "Arthas",
    });
  });

  test("GLEADER parses guild leader", () => {
    expect(parseIpcCommand("GLEADER Sylvanas")).toEqual({
      type: "guild_leader",
      target: "Sylvanas",
    });
  });

  test("GMOTD parses guild motd", () => {
    expect(parseIpcCommand("GMOTD Raid tonight")).toEqual({
      type: "guild_motd",
      message: "Raid tonight",
    });
  });

  test("GMOTD with empty message clears motd", () => {
    expect(parseIpcCommand("GMOTD")).toEqual({
      type: "guild_motd",
      message: "",
    });
  });

  test("GACCEPT parses guild accept", () => {
    expect(parseIpcCommand("GACCEPT")).toEqual({ type: "guild_accept" });
  });

  test("GDECLINE parses guild decline", () => {
    expect(parseIpcCommand("GDECLINE")).toEqual({ type: "guild_decline" });
  });

  test("/ginvite via slash parses guild invite", () => {
    expect(parseIpcCommand("/ginvite Thrall")).toEqual({
      type: "guild_invite",
      target: "Thrall",
    });
  });

  test("/gaccept via slash parses guild accept", () => {
    expect(parseIpcCommand("/gaccept")).toEqual({ type: "guild_accept" });
  });

  test("/gdecline via slash parses guild decline", () => {
    expect(parseIpcCommand("/gdecline")).toEqual({ type: "guild_decline" });
  });

  test("/gkick via slash parses guild kick", () => {
    expect(parseIpcCommand("/gkick Garrosh")).toEqual({
      type: "guild_kick",
      target: "Garrosh",
    });
  });

  test("/gleave via slash parses guild leave", () => {
    expect(parseIpcCommand("/gleave")).toEqual({ type: "guild_leave" });
  });

  test("/gpromote via slash parses guild promote", () => {
    expect(parseIpcCommand("/gpromote Jaina")).toEqual({
      type: "guild_promote",
      target: "Jaina",
    });
  });

  test("/gdemote via slash parses guild demote", () => {
    expect(parseIpcCommand("/gdemote Arthas")).toEqual({
      type: "guild_demote",
      target: "Arthas",
    });
  });

  test("/gleader via slash parses guild leader", () => {
    expect(parseIpcCommand("/gleader Sylvanas")).toEqual({
      type: "guild_leader",
      target: "Sylvanas",
    });
  });

  test("/gmotd via slash parses guild motd", () => {
    expect(parseIpcCommand("/gmotd Raid tonight")).toEqual({
      type: "guild_motd",
      message: "Raid tonight",
    });
  });
});

describe("dispatchCommand", () => {
  test("say calls sendSay and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const result = await dispatchCommand(
      { type: "say", message: "hello" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(result).toBe(false);
    expect(handle.sendSay).toHaveBeenCalledWith("hello");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("yell calls sendYell and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "yell", message: "HEY" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendYell).toHaveBeenCalledWith("HEY");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild calls sendGuild and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild", message: "inv pls" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendGuild).toHaveBeenCalledWith("inv pls");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("party calls sendParty and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "party", message: "pull" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendParty).toHaveBeenCalledWith("pull");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("emote calls sendEmote and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "emote", message: "waves hello" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendEmote).toHaveBeenCalledWith("waves hello");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("dnd calls sendDnd and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "dnd", message: "busy" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendDnd).toHaveBeenCalledWith("busy");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("afk calls sendAfk and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "afk", message: "grabbing coffee" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendAfk).toHaveBeenCalledWith("grabbing coffee");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("roll calls sendRoll and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "roll", min: 1, max: 100 },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendRoll).toHaveBeenCalledWith(1, 100);
    expect(socket.written()).toBe("OK\n\n");
  });

  test("whisper calls sendWhisper and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "whisper", target: "Xiara", message: "hey" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.sendWhisper).toHaveBeenCalledWith("Xiara", "hey");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("read drains ring buffer text", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    events.push({ text: "[say] Alice: hi", json: '{"type":"SAY"}' });
    events.push({ text: "[say] Bob: hey", json: '{"type":"SAY"}' });
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "read" }, handle, events, socket, cleanup);

    expect(socket.written()).toBe("[say] Alice: hi\n[say] Bob: hey\n\n");
  });

  test("read on empty buffer writes just terminator", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "read" }, handle, events, socket, cleanup);

    expect(socket.written()).toBe("\n");
  });

  test("read_wait delays then returns window events", async () => {
    jest.useFakeTimers();
    try {
      const handle = createMockHandle();
      const events = new RingBuffer<EventEntry>(10);
      const socket = createMockSocket();
      const cleanup = jest.fn();

      const promise = dispatchCommand(
        { type: "read_wait", ms: 1000 },
        handle,
        events,
        socket,
        cleanup,
      );

      expect(socket.written()).toBe("");
      events.push({ text: "[say] Alice: hi", json: '{"type":"SAY"}' });
      jest.advanceTimersByTime(1000);
      await promise;
      expect(socket.written()).toBe("[say] Alice: hi\n\n");
    } finally {
      jest.useRealTimers();
    }
  });

  test("read_wait returns only events arriving during wait window", async () => {
    jest.useFakeTimers();
    try {
      const handle = createMockHandle();
      const events = new RingBuffer<EventEntry>(10);
      events.push({ text: "[say] Old: before", json: '{"type":"SAY"}' });
      const socket = createMockSocket();
      const cleanup = jest.fn();

      const promise = dispatchCommand(
        { type: "read_wait", ms: 1000 },
        handle,
        events,
        socket,
        cleanup,
      );

      events.push({ text: "[say] New: during", json: '{"type":"SAY"}' });
      jest.advanceTimersByTime(1000);
      await promise;
      expect(socket.written()).toBe("[say] New: during\n\n");
      expect(events.drain()).toEqual([
        { text: "[say] Old: before", json: '{"type":"SAY"}' },
        { text: "[say] New: during", json: '{"type":"SAY"}' },
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("status writes CONNECTED", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "status" }, handle, events, socket, cleanup);

    expect(socket.written()).toBe("CONNECTED\n\n");
  });

  test("stop calls cleanup and returns true", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const result = await dispatchCommand(
      { type: "stop" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(result).toBe(true);
    expect(cleanup).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("who passes filter and formats results", async () => {
    const handle = createMockHandle();
    (handle.who as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        name: "Test",
        guild: "G",
        level: 80,
        classId: 1,
        race: 1,
        gender: 0,
        zone: 1,
      },
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "who", filter: "mage" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.who).toHaveBeenCalledWith({ name: "mage" });
    expect(socket.written()).toContain("[who] 1 results: Test (80)");
  });

  test("who without filter passes empty object", async () => {
    const handle = createMockHandle();
    (handle.who as ReturnType<typeof jest.fn>).mockResolvedValue([]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "who" }, handle, events, socket, cleanup);

    expect(handle.who).toHaveBeenCalledWith({});
  });

  test("read_json drains ring buffer json", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    events.push({
      text: "[say] Alice: hi",
      json: '{"type":"SAY","sender":"Alice","message":"hi"}',
    });
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "read_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(socket.written()).toBe(
      '{"type":"SAY","sender":"Alice","message":"hi"}\n\n',
    );
  });

  test("read_wait_json delays then returns window events", async () => {
    jest.useFakeTimers();
    try {
      const handle = createMockHandle();
      const events = new RingBuffer<EventEntry>(10);
      const socket = createMockSocket();
      const cleanup = jest.fn();

      const promise = dispatchCommand(
        { type: "read_wait_json", ms: 500 },
        handle,
        events,
        socket,
        cleanup,
      );

      expect(socket.written()).toBe("");
      events.push({ text: "[say] Alice: hi", json: '{"type":"SAY"}' });
      jest.advanceTimersByTime(500);
      await promise;
      expect(socket.written()).toBe('{"type":"SAY"}\n\n');
    } finally {
      jest.useRealTimers();
    }
  });

  test("read_wait_json returns only events arriving during wait window", async () => {
    jest.useFakeTimers();
    try {
      const handle = createMockHandle();
      const events = new RingBuffer<EventEntry>(10);
      events.push({ text: "[say] Old: before", json: '{"old":true}' });
      const socket = createMockSocket();
      const cleanup = jest.fn();

      const promise = dispatchCommand(
        { type: "read_wait_json", ms: 500 },
        handle,
        events,
        socket,
        cleanup,
      );

      events.push({ text: "[say] New: during", json: '{"new":true}' });
      jest.advanceTimersByTime(500);
      await promise;
      expect(socket.written()).toBe('{"new":true}\n\n');
    } finally {
      jest.useRealTimers();
    }
  });

  test("invite calls handle.invite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "invite", target: "Voidtrix" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.invite).toHaveBeenCalledWith("Voidtrix");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("kick calls handle.uninvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "kick", target: "Voidtrix" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.uninvite).toHaveBeenCalledWith("Voidtrix");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("leave calls handle.leaveGroup and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "leave" }, handle, events, socket, cleanup);

    expect(handle.leaveGroup).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("join_channel calls handle.joinChannel and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "join_channel", channel: "Trade" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.joinChannel).toHaveBeenCalledWith("Trade", undefined);
    expect(socket.written()).toBe("OK\n\n");
  });

  test("join_channel with password passes it through", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "join_channel", channel: "Secret", password: "hunter2" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.joinChannel).toHaveBeenCalledWith("Secret", "hunter2");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("leave_channel calls handle.leaveChannel and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "leave_channel", channel: "Trade" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.leaveChannel).toHaveBeenCalledWith("Trade");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("leader calls handle.setLeader and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "leader", target: "Voidtrix" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.setLeader).toHaveBeenCalledWith("Voidtrix");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("accept calls handle.acceptInvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "accept" }, handle, events, socket, cleanup);

    expect(handle.acceptInvite).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("decline calls handle.declineInvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "decline" }, handle, events, socket, cleanup);

    expect(handle.declineInvite).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("who_json returns JSON formatted results", async () => {
    const handle = createMockHandle();
    (handle.who as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        name: "Test",
        guild: "G",
        level: 80,
        classId: 1,
        race: 1,
        gender: 0,
        zone: 1,
      },
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "who_json", filter: "mage" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.who).toHaveBeenCalledWith({ name: "mage" });
    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("WHO");
    expect(parsed.count).toBe(1);
    expect(parsed.results[0].name).toBe("Test");
  });

  test("nearby returns formatted entity list", async () => {
    const handle = createMockHandle();
    const testUnit: UnitEntity = {
      guid: 1n,
      objectType: ObjectType.UNIT,
      name: "Thrall",
      level: 80,
      health: 5000,
      maxHealth: 5000,
      entry: 0,
      scale: 1,
      position: { mapId: 1, x: 1.23, y: 4.56, z: 7.89, orientation: 0 },
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    const testGo: GameObjectEntity = {
      guid: 2n,
      objectType: ObjectType.GAMEOBJECT,
      name: "Mailbox",
      entry: 0,
      scale: 1,
      position: { mapId: 1, x: 1.5, y: 4.6, z: 7.89, orientation: 0 },
      rawFields: new Map(),
      displayId: 0,
      flags: 0,
      gameObjectType: 19,
      bytes1: 0,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testUnit,
      testGo,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "nearby" }, handle, events, socket, cleanup);

    const output = socket.written();
    expect(output).toContain(
      "Thrall (NPC, level 80) HP 5000/5000 at 1.23, 4.56, 7.89",
    );
    expect(output).toContain("Mailbox (GameObject) at 1.50, 4.60, 7.89");
  });

  test("nearby_json returns JSONL entity list", async () => {
    const handle = attachControl(createMockHandle());
    const testUnit: UnitEntity = {
      guid: 1n,
      objectType: ObjectType.UNIT,
      name: "Thrall",
      level: 80,
      health: 5000,
      maxHealth: 5000,
      entry: 0,
      scale: 1,
      position: { mapId: 1, x: 1.23, y: 4.56, z: 7.89, orientation: 0 },
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testUnit,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "nearby_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    const lines = socket.written().trim().split("\n").filter(Boolean);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.guid).toBe("0x1");
    expect(parsed.type).toBe("unit");
    expect(parsed.name).toBe("Thrall");
    expect(parsed.level).toBe(80);
    expect(parsed.health).toBe(5000);
    expect(parsed.maxHealth).toBe(5000);
    expect(parsed.x).toBe(1.23);
    expect(parsed.y).toBe(4.56);
    expect(parsed.z).toBe(7.89);
  });

  test("nearby with no entities returns just terminator", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "nearby" }, handle, events, socket, cleanup);

    expect(socket.written()).toBe("\n");
  });

  test("nearby formats player entity", async () => {
    const handle = createMockHandle();
    const testPlayer: UnitEntity = {
      guid: 10n,
      objectType: ObjectType.PLAYER,
      name: "Arthas",
      level: 55,
      health: 3000,
      maxHealth: 4000,
      entry: 0,
      scale: 1,
      position: { mapId: 0, x: 10.0, y: 20.0, z: 30.0, orientation: 0 },
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testPlayer,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "nearby" }, handle, events, socket, cleanup);

    const output = socket.written();
    expect(output).toContain(
      "Arthas (Player, level 55) HP 3000/4000 at 10.00, 20.00, 30.00",
    );
  });

  test("nearby formats unknown entity type", async () => {
    const handle = createMockHandle();
    const testCorpse: BaseEntity = {
      guid: 0xabn,
      objectType: ObjectType.CORPSE,
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      name: undefined,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testCorpse,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "nearby" }, handle, events, socket, cleanup);

    const output = socket.written();
    expect(output).toContain("Entity 0xab (type 7)");
  });

  test("nearby_json formats player and gameobject types", async () => {
    const handle = attachControl(createMockHandle());
    const testPlayer: UnitEntity = {
      guid: 1n,
      objectType: ObjectType.PLAYER,
      name: "Jaina",
      level: 70,
      health: 8000,
      maxHealth: 8000,
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    const testGo: GameObjectEntity = {
      guid: 2n,
      objectType: ObjectType.GAMEOBJECT,
      name: "Chest",
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      displayId: 0,
      flags: 0,
      gameObjectType: 3,
      bytes1: 0,
    };
    const testCorpse: BaseEntity = {
      guid: 3n,
      objectType: ObjectType.CORPSE,
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      name: undefined,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testPlayer,
      testGo,
      testCorpse,
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "nearby_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    const lines = socket.written().trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    const player = JSON.parse(lines[0]!);
    const go = JSON.parse(lines[1]!);
    const corpse = JSON.parse(lines[2]!);
    expect(player.type).toBe("player");
    expect(player.level).toBe(70);
    expect(player.health).toBe(8000);
    expect(player.distance).toBe(0);
    expect(player.horizontalDistance).toBeNull();
    expect(player.originSource).toBeNull();
    expect(go.distance).toBeNull();
    expect(go.bearingRadians).toBeNull();
    expect(go.type).toBe("gameobject");
    expect(go.gameObjectType).toBe(3);
    expect(corpse.type).toBe("object");
  });

  test("nearby_json uses predicted self pose for distance, order, and range", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(
      sampleState({
        selfGuid: 0x1n,
        pose: {
          mapId: 530,
          x: 10,
          y: 10,
          z: 10,
          orientation: 0,
          source: "predicted",
          updatedAt: 1000,
        },
      }),
    );
    const selfEntity: UnitEntity = {
      guid: 0x1n,
      objectType: ObjectType.PLAYER,
      name: "PlayerOne",
      entry: 0,
      scale: 1,
      position: { mapId: 530, x: 1000, y: 1000, z: 10, orientation: 0 },
      rawFields: new Map(),
      health: 100,
      maxHealth: 100,
      level: 70,
      factionTemplate: 1,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 1,
      class_: 1,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    const near1: UnitEntity = {
      ...selfEntity,
      guid: 0x2n,
      name: "NearUnit",
      position: { mapId: 530, x: 13, y: 14, z: 10, orientation: 0 },
    };
    const near2: GameObjectEntity = {
      guid: 0x3n,
      objectType: ObjectType.GAMEOBJECT,
      name: "NearChest",
      entry: 100,
      scale: 1,
      position: { mapId: 530, x: 20, y: 10, z: 10, orientation: 0 },
      rawFields: new Map(),
      displayId: 0,
      flags: 0,
      gameObjectType: 3,
      bytes1: 0,
    };
    const distant: GameObjectEntity = {
      ...near2,
      guid: 0x4n,
      name: "DistantElevator",
      gameObjectType: 11,
      position: { mapId: 530, x: 200, y: 10, z: 10, orientation: 0 },
    };
    const offMap: UnitEntity = {
      ...selfEntity,
      guid: 0x5n,
      name: "OffMapUnit",
      position: { mapId: 0, x: 10, y: 10, z: 10, orientation: 0 },
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      distant,
      near2,
      selfEntity,
      offMap,
      near1,
    ]);

    const socket = createMockSocket();
    await dispatchCommand(
      { type: "nearby_json" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );

    const rows = socket
      .written()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(3);
    expect(rows[0]!.guid).toBe("0x1");
    expect(rows[0]!.self).toBe(true);
    expect(rows[0]!.distance).toBe(0);
    expect(rows[0]!.x).toBe(10);
    expect(rows[0]!.y).toBe(10);
    expect(rows[0]!.bearingRadians).toBeNull();
    expect(rows[0]!.turnRadians).toBeNull();
    expect(rows[1]!.guid).toBe("0x2");
    expect(rows[1]!.distance).toBe(5);
    expect(rows[1]!.horizontalDistance).toBe(5);
    expect(rows[1]!.bearingRadians).toBeCloseTo(0.927295218, 8);
    expect(rows[1]!.turnRadians).toBeCloseTo(0.927295218, 8);
    expect(rows[1]!.originSource).toBe("predicted");
    expect(rows[1]!.originUpdatedAt).toBe(1000);
    expect(rows[2]!.guid).toBe("0x3");
    expect(rows[2]!.distance).toBe(10);
  });

  test("nearby excludes a target beyond 100 yards before rounding", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(sampleState());
    const target: BaseEntity = {
      guid: 0xfn,
      objectType: ObjectType.CORPSE,
      entry: 0,
      scale: 1,
      position: {
        mapId: 530,
        x: 8809.464,
        y: -6671.76,
        z: 70.34,
        orientation: 0,
      },
      rawFields: new Map(),
      name: undefined,
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      target,
    ]);
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "nearby_json" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(socket.written()).toBe("\n");
  });

  test("nearby_json with all returns distant and off-map entities", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(
      sampleState({
        selfGuid: 0x1n,
        pose: {
          mapId: 530,
          x: 10,
          y: 10,
          z: 10,
          orientation: 0,
          source: "predicted",
          updatedAt: 1000,
        },
      }),
    );
    const selfEntity: UnitEntity = {
      guid: 0x1n,
      objectType: ObjectType.PLAYER,
      name: "PlayerOne",
      entry: 0,
      scale: 1,
      position: { mapId: 530, x: 10, y: 10, z: 10, orientation: 0 },
      rawFields: new Map(),
      health: 100,
      maxHealth: 100,
      level: 70,
      factionTemplate: 1,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 1,
      class_: 1,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    const near: UnitEntity = {
      ...selfEntity,
      guid: 0x2n,
      name: "NearUnit",
      position: { mapId: 530, x: 13, y: 14, z: 10, orientation: 0 },
    };
    const distant: GameObjectEntity = {
      guid: 0x4n,
      objectType: ObjectType.GAMEOBJECT,
      name: "DistantElevator",
      entry: 100,
      scale: 1,
      displayId: 0,
      flags: 0,
      gameObjectType: 11,
      bytes1: 0,
      position: { mapId: 530, x: 210, y: 10, z: 10, orientation: 0 },
      rawFields: new Map(),
    };
    const offMap: UnitEntity = {
      ...selfEntity,
      guid: 0x5n,
      name: "OffMapUnit",
      position: { mapId: 0, x: 10, y: 10, z: 10, orientation: 0 },
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      distant,
      offMap,
      selfEntity,
      near,
    ]);

    const socket = createMockSocket();
    await dispatchCommand(
      { type: "nearby_json", all: true },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );

    const rows = socket
      .written()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(4);
    expect(rows[0]!.guid).toBe("0x1");
    expect(rows[0]!.distance).toBe(0);
    expect(rows[1]!.guid).toBe("0x2");
    expect(rows[1]!.distance).toBe(5);
    expect(rows[2]!.guid).toBe("0x4");
    expect(rows[2]!.distance).toBe(200);
    expect(rows[3]!.guid).toBe("0x5");
    expect(rows[3]!.distance).toBeNull();
    expect(rows[3]!.horizontalDistance).toBeNull();
    expect(rows[3]!.bearingRadians).toBeNull();
    expect(rows[3]!.turnRadians).toBeNull();
  });

  test("nearby plain text filters by range and supports all", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(
      sampleState({
        selfGuid: 0x1n,
        pose: {
          mapId: 530,
          x: 10,
          y: 10,
          z: 10,
          orientation: 0,
          source: "predicted",
          updatedAt: 1000,
        },
      }),
    );
    const selfEntity: UnitEntity = {
      guid: 0x1n,
      objectType: ObjectType.PLAYER,
      name: "PlayerOne",
      entry: 0,
      scale: 1,
      position: { mapId: 530, x: 1000, y: 1000, z: 10, orientation: 0 },
      rawFields: new Map(),
      health: 100,
      maxHealth: 100,
      level: 70,
      factionTemplate: 1,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 1,
      class_: 1,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    const near: UnitEntity = {
      ...selfEntity,
      guid: 0x2n,
      name: "NearUnit",
      position: { mapId: 530, x: 13, y: 14, z: 10, orientation: 0 },
    };
    const distant: GameObjectEntity = {
      guid: 0x4n,
      objectType: ObjectType.GAMEOBJECT,
      name: "DistantElevator",
      entry: 100,
      scale: 1,
      displayId: 0,
      flags: 0,
      gameObjectType: 11,
      bytes1: 0,
      position: { mapId: 530, x: 210, y: 10, z: 10, orientation: 0 },
      rawFields: new Map(),
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      distant,
      near,
      selfEntity,
    ]);

    const socket1 = createMockSocket();
    await dispatchCommand(
      { type: "nearby" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket1,
      jest.fn(),
    );
    const lines1 = socket1.written().trim().split("\n");
    expect(lines1).toHaveLength(2);
    expect(lines1[0]).toContain("PlayerOne");
    expect(lines1[0]).toContain("at 10.00, 10.00, 10.00");
    expect(lines1[1]).toContain("NearUnit");
    expect(lines1[1]).toContain("0x2");
    expect(lines1[1]).toContain("5.00 yd");
    expect(lines1[1]).toContain("xy=5.00 yd");
    expect(lines1[1]).toContain("face=0.9273");
    expect(lines1[1]).toContain("turn=0.9273");
    expect(lines1[1]).toContain("predicted");

    const socket2 = createMockSocket();
    await dispatchCommand(
      { type: "nearby", all: true },
      handle,
      new RingBuffer<EventEntry>(10),
      socket2,
      jest.fn(),
    );
    const lines2 = socket2.written().trim().split("\n");
    expect(lines2).toHaveLength(3);
    expect(lines2[0]).toContain("PlayerOne");
    expect(lines2[1]).toContain("NearUnit");
    expect(lines2[2]).toContain("DistantElevator");
  });

  test("friends calls getFriends and writes friend list", async () => {
    const handle = createMockHandle();
    (handle.getFriends as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "friends" }, handle, events, socket, cleanup);

    expect(handle.getFriends).toHaveBeenCalled();
    expect(socket.written()).toContain("No friends on your list");
  });

  test("friends_json calls getFriends and writes JSON", async () => {
    const handle = createMockHandle();
    (handle.getFriends as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "friends_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.getFriends).toHaveBeenCalled();
    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("FRIENDS");
    expect(parsed.count).toBe(0);
  });

  test("add_friend calls handle.addFriend and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "add_friend", target: "Arthas" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.addFriend).toHaveBeenCalledWith("Arthas");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("del_friend calls handle.removeFriend and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "del_friend", target: "Arthas" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.removeFriend).toHaveBeenCalledWith("Arthas");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("ignored calls getIgnored and writes ignore list", async () => {
    const handle = createMockHandle();
    (handle.getIgnored as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand({ type: "ignored" }, handle, events, socket, cleanup);

    expect(handle.getIgnored).toHaveBeenCalled();
    expect(socket.written()).toContain("Ignore list is empty");
  });

  test("ignored_json calls getIgnored and writes JSON", async () => {
    const handle = createMockHandle();
    (handle.getIgnored as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "ignored_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.getIgnored).toHaveBeenCalled();
    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("IGNORED");
    expect(parsed.count).toBe(0);
  });

  test("add_ignore calls handle.addIgnore and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "add_ignore", target: "Spammer" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.addIgnore).toHaveBeenCalledWith("Spammer");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("del_ignore calls handle.removeIgnore and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "del_ignore", target: "Spammer" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.removeIgnore).toHaveBeenCalledWith("Spammer");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_roster calls requestGuildRoster and writes roster", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_roster" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.requestGuildRoster).toHaveBeenCalled();
    expect(socket.written()).toContain("No guild roster available");
  });

  test("guild_roster_json calls requestGuildRoster and writes JSON", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_roster_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.requestGuildRoster).toHaveBeenCalled();
    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("GUILD_ROSTER");
    expect(parsed.members).toEqual([]);
  });

  test("guild_roster with data writes formatted roster", async () => {
    const handle = createMockHandle();
    const roster = {
      guildName: "Horde Elite",
      motd: "Welcome!",
      guildInfo: "",
      rankNames: ["GM"],
      members: [
        {
          guid: 1n,
          name: "Thrall",
          rankIndex: 0,
          level: 80,
          playerClass: 7,
          gender: 0,
          area: 10,
          status: 1,
          timeOffline: 0,
          publicNote: "",
          officerNote: "",
        },
      ],
    };
    (handle.requestGuildRoster as ReturnType<typeof jest.fn>).mockResolvedValue(
      roster,
    );
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_roster" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(socket.written()).toContain("Horde Elite");
    expect(socket.written()).toContain("Thrall");
  });

  test("guild_roster_json with data writes JSON roster", async () => {
    const handle = createMockHandle();
    const roster = {
      guildName: "Horde Elite",
      motd: "Welcome!",
      guildInfo: "",
      rankNames: ["GM"],
      members: [
        {
          guid: 1n,
          name: "Thrall",
          rankIndex: 0,
          level: 80,
          playerClass: 7,
          gender: 0,
          area: 10,
          status: 1,
          timeOffline: 0,
          publicNote: "",
          officerNote: "",
        },
      ],
    };
    (handle.requestGuildRoster as ReturnType<typeof jest.fn>).mockResolvedValue(
      roster,
    );
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_roster_json" },
      handle,
      events,
      socket,
      cleanup,
    );

    const parsed = JSON.parse(socket.written().replace(/\n+$/, ""));
    expect(parsed.type).toBe("GUILD_ROSTER");
    expect(parsed.guildName).toBe("Horde Elite");
    expect(parsed.count).toBe(1);
  });

  test("guild_invite calls handle.guildInvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_invite", target: "Thrall" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.guildInvite).toHaveBeenCalledWith("Thrall");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_kick calls handle.guildRemove and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_kick", target: "Garrosh" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.guildRemove).toHaveBeenCalledWith("Garrosh");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_leave calls handle.guildLeave and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_leave" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.guildLeave).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_promote calls handle.guildPromote and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_promote", target: "Jaina" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.guildPromote).toHaveBeenCalledWith("Jaina");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_demote calls handle.guildDemote and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_demote", target: "Arthas" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.guildDemote).toHaveBeenCalledWith("Arthas");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_leader calls handle.guildLeader and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_leader", target: "Sylvanas" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.guildLeader).toHaveBeenCalledWith("Sylvanas");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_motd calls handle.guildMotd and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_motd", message: "Raid tonight" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.guildMotd).toHaveBeenCalledWith("Raid tonight");
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_accept calls handle.acceptGuildInvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_accept" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.acceptGuildInvite).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("guild_decline calls handle.declineGuildInvite and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "guild_decline" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(handle.declineGuildInvite).toHaveBeenCalled();
    expect(socket.written()).toBe("OK\n\n");
  });

  test("unimplemented writes UNIMPLEMENTED response", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const result = await dispatchCommand(
      { type: "unimplemented", feature: "Friends list" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(result).toBe(false);
    expect(socket.written()).toBe("UNIMPLEMENTED Friends list\n\n");
  });

  test("chat sends via sendInCurrentMode and responds with mode", async () => {
    const handle = createMockHandle();
    (handle.getLastChatMode as ReturnType<typeof jest.fn>).mockReturnValue({
      type: "say",
    });
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const result = await dispatchCommand(
      { type: "chat", message: "hello" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(result).toBe(false);
    expect(handle.sendInCurrentMode).toHaveBeenCalledWith("hello");
    expect(socket.written()).toBe("OK SAY\n\n");
  });

  test("chat mode label includes whisper target", async () => {
    const handle = createMockHandle();
    (handle.getLastChatMode as ReturnType<typeof jest.fn>).mockReturnValue({
      type: "whisper",
      target: "Xiara",
    });
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "chat", message: "follow me" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(socket.written()).toBe("OK WHISPER Xiara\n\n");
  });

  test("chat mode label includes channel name", async () => {
    const handle = createMockHandle();
    (handle.getLastChatMode as ReturnType<typeof jest.fn>).mockReturnValue({
      type: "channel",
      channel: "General",
    });
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { type: "chat", message: "hello general" },
      handle,
      events,
      socket,
      cleanup,
    );

    expect(socket.written()).toBe("OK CHANNEL General\n\n");
  });

  test("move calls handle and writes OK", async () => {
    const handle = attachControl(createMockHandle());
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();
    const result = await dispatchCommand(
      { type: "move", direction: "forward", durationMs: 1000 },
      handle,
      events,
      socket,
      cleanup,
    );
    expect(result).toBe(false);
    expect(handle.move).toHaveBeenCalledWith("forward", 1000);
    expect(socket.written()).toBe("OK\n\n");
    expect(cleanup).not.toHaveBeenCalled();
  });

  test("malformed move does not call handle", async () => {
    const handle = attachControl(createMockHandle());
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "invalid", reason: "invalid direction" },
      handle,
      events,
      socket,
      jest.fn(),
    );
    expect(handle.move).not.toHaveBeenCalled();
    expect(handle.face).not.toHaveBeenCalled();
    expect(handle.selectTarget).not.toHaveBeenCalled();
    expect(handle.halt).not.toHaveBeenCalled();
    expect(socket.written().startsWith("ERR ")).toBe(true);
  });

  test("move runtime errors surface as ERR without success", async () => {
    const handle = attachControl(createMockHandle());
    handle.move.mockImplementation(() => {
      throw new Error("rooted");
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "move", direction: "forward", durationMs: 500 },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(handle.move).toHaveBeenCalled();
    expect(socket.written()).toBe("ERR rooted\n\n");
  });

  test("control json uses hex guids and pose source", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(sampleState());
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "control_json" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    const parsed = JSON.parse(socket.written().trim());
    expect(parsed.selfGuid).toBe("0xabcde");
    expect(parsed.target).toBe("0xa");
    expect(parsed.requestedTarget).toBe("0xa");
    expect(parsed.pose.source).toBe("predicted");
    expect(parsed.serverPose.source).toBe("server");
    expect(parsed.moving).toBe(true);
    expect(parsed.direction).toBe("forward");
    expect(parsed.owner).toBe("manual");
  });

  test("control json reports obstructed blockedReason", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(
      sampleState({
        moving: false,
        direction: undefined,
        blockedReason: "obstructed",
      }),
    );
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "control_json" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    const parsed = JSON.parse(socket.written().trim());
    expect(parsed.moving).toBe(false);
    expect(parsed.blockedReason).toBe("obstructed");
    expect(parsed.nextStep).toContain("different route");
  });

  test("control recommends a new heading after unresolved height", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(
      sampleState({ moving: false, blockedReason: "height_unresolved" }),
    );
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "control_json" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(JSON.parse(socket.written().trim()).nextStep).toContain(
      "different short heading",
    );
  });

  test("navigation refuses an ambiguous column without guessing Z", async () => {
    const handle = attachControl(createMockHandle());
    handle.getNavigationState.mockReturnValue({
      active: false,
      destination: { x: 8713.8, y: -6625.3, z: 70 },
      remaining: undefined,
      owner: "none",
      blockedReason: "ambiguous ground column",
      refusal: "pick_destination",
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "navigation_json" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    const state = JSON.parse(socket.written().trim());
    expect(state.blockedReason).toBe("ambiguous ground column");
    expect(state.refusal).toBe("pick_destination");
    expect(state.nextStep).toContain("one ground height");
    expect(state.nextStep).toContain("Do not guess Z");
  });

  test("control text distinguishes predicted from server pose", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(sampleState());
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "control" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    const output = socket.written();
    expect(output).toContain("current pose predicted");
    expect(output).toContain("last server pose server");
    expect(output).toContain("updatedAt=1000");
    expect(output).toContain("updatedAt=900");
    expect(output).toContain("0xabcde");
    expect(output).not.toContain("authoritative");
  });

  test("nearby json includes targeting fields", async () => {
    const handle = attachControl(createMockHandle());
    const testUnit: UnitEntity = {
      guid: 0x11n,
      objectType: ObjectType.UNIT,
      name: "Lynx",
      level: 8,
      health: 100,
      maxHealth: 120,
      entry: 15652,
      scale: 1,
      position: {
        mapId: 530,
        x: 1,
        y: 2,
        z: 3,
        orientation: 0.5,
      },
      rawFields: new Map(),
      factionTemplate: 7,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0x2n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testUnit,
    ]);
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "nearby_json" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    const parsed = JSON.parse(socket.written().trim());
    expect(parsed.guid).toBe("0x11");
    expect(parsed.entry).toBe(15652);
    expect(parsed.mapId).toBe(530);
    expect(parsed.orientation).toBe(0.5);
    expect(parsed.target).toBe("0x2");
    expect(parsed.unitFlags).toBe(0);
    expect(parsed.self).toBe(false);
  });

  test("nearby json marks only the observed self guid", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(sampleState({ selfGuid: 0x10n }));
    const selfPlayer: UnitEntity = {
      guid: 0x10n,
      objectType: ObjectType.PLAYER,
      name: "Xiara",
      level: 10,
      health: 187,
      maxHealth: 187,
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    const otherPlayer: UnitEntity = {
      ...selfPlayer,
      guid: 0x11n,
      name: "Landra",
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      selfPlayer,
      otherPlayer,
    ]);
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "nearby_json" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    const rows = socket
      .written()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows[0]!.self).toBe(true);
    expect(rows[1]!.self).toBe(false);
  });

  test("halt does not teardown while stop does", async () => {
    const handle = attachControl(createMockHandle());
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();
    const halted = await dispatchCommand(
      { type: "halt" },
      handle,
      events,
      socket,
      cleanup,
    );
    expect(halted).toBe(false);
    expect(cleanup).not.toHaveBeenCalled();
    const stopped = await dispatchCommand(
      { type: "stop" },
      handle,
      events,
      socket,
      cleanup,
    );
    expect(stopped).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe("writeLines", () => {
  test("writes each line with newline then blank terminator", () => {
    const socket = createMockSocket();
    writeLines(socket, ["line1", "line2"]);
    expect(socket.written()).toBe("line1\nline2\n\n");
  });

  test("empty array writes just terminator", () => {
    const socket = createMockSocket();
    writeLines(socket, []);
    expect(socket.written()).toBe("\n");
  });
});

describe("onChatMessage", () => {
  test("pushes formatted message to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log: SessionLog = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;

    onChatMessage(
      { type: ChatType.SAY, sender: "Alice", message: "hi" },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained[0]!.text).toBe("[say] Alice: hi");
    expect(JSON.parse(drained[0]!.json)).toEqual({
      type: "SAY",
      sender: "Alice",
      message: "hi",
    });
  });

  test("appends JSON to session log", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.resolve());
    const log: SessionLog = { append } as unknown as SessionLog;

    onChatMessage(
      { type: ChatType.WHISPER, sender: "Eve", message: "psst" },
      events,
      log,
    );

    expect(append).toHaveBeenCalledWith({
      type: "WHISPER_FROM",
      sender: "Eve",
      message: "psst",
    });
  });

  test("swallows session log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log: SessionLog = { append } as unknown as SessionLog;

    onChatMessage(
      { type: ChatType.WHISPER, sender: "Eve", message: "psst" },
      events,
      log,
    );
    await Promise.resolve();

    expect(append).toHaveBeenCalled();
  });
});

describe("onGroupEvent", () => {
  test("pushes group_list with undefined text to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log: SessionLog = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;

    onGroupEvent(
      {
        type: "group_list",
        members: [{ name: "Alice", guidLow: 1, guidHigh: 0, online: true }],
        leader: "Alice",
      },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toBeUndefined();
    expect(JSON.parse(drained[0]!.json)).toMatchObject({ type: "GROUP_LIST" });
  });

  test("pushes member_stats to session log", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.resolve());
    const log: SessionLog = { append } as unknown as SessionLog;

    onGroupEvent(
      { type: "member_stats", guidLow: 42, hp: 100, maxHp: 200 },
      events,
      log,
    );

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ type: "PARTY_MEMBER_STATS", guidLow: 42 }),
    );
  });

  test("swallows group event log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log: SessionLog = { append } as unknown as SessionLog;

    onGroupEvent({ type: "group_destroyed" }, events, log);
    await Promise.resolve();

    expect(append).toHaveBeenCalled();
  });

  test("pushes displayable events with text", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log: SessionLog = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;

    onGroupEvent({ type: "invite_received", from: "Bob" }, events, log);

    const drained = events.drain();
    expect(drained[0]!.text).toBe("[group] Bob invites you to a group");
  });

  test("serializes command_result event details", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log: SessionLog = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;

    onGroupEvent(
      {
        type: "command_result",
        operation: 1,
        target: "Voidtrix",
        result: 0,
      },
      events,
      log,
    );

    const drained = events.drain();
    expect(JSON.parse(drained[0]!.json)).toEqual({
      type: "GROUP_COMMAND_RESULT",
      operation: 1,
      target: "Voidtrix",
      result: 0,
    });
  });

  test("serializes leader/group lifecycle events", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log: SessionLog = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;

    onGroupEvent({ type: "leader_changed", name: "Alice" }, events, log);
    onGroupEvent({ type: "group_destroyed" }, events, log);
    onGroupEvent({ type: "kicked" }, events, log);
    onGroupEvent({ type: "invite_declined", name: "Bob" }, events, log);

    const drained = events.drain().map((entry) => JSON.parse(entry.json));
    expect(drained).toEqual([
      { type: "GROUP_LEADER_CHANGED", name: "Alice" },
      { type: "GROUP_DESTROYED" },
      { type: "GROUP_KICKED" },
      { type: "GROUP_INVITE_DECLINED", name: "Bob" },
    ]);
  });
});

describe("onEntityEvent", () => {
  test("pushes appear event to ring buffer with text and json", () => {
    const events = new RingBuffer<EventEntry>(10);
    const entity: UnitEntity = {
      guid: 1n,
      objectType: ObjectType.UNIT,
      name: "Test NPC",
      level: 10,
      health: 100,
      maxHealth: 100,
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };

    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;
    onEntityEvent({ type: "appear", entity }, events, log);

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("Test NPC");
    expect(drained[0]!.text).toContain("appeared");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("ENTITY_APPEAR");
    expect(json.name).toBe("Test NPC");
    expect(append).toHaveBeenCalledTimes(1);
  });

  test("pushes disappear event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;
    onEntityEvent(
      { type: "disappear", guid: 1n, name: "Gone NPC" },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("Gone NPC");
    expect(drained[0]!.text).toContain("left range");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("ENTITY_DISAPPEAR");
  });

  test("skips update events with no obj", () => {
    const events = new RingBuffer<EventEntry>(10);
    const entity: UnitEntity = {
      guid: 1n,
      objectType: ObjectType.UNIT,
      name: "Test NPC",
      level: 10,
      health: 100,
      maxHealth: 100,
      entry: 0,
      scale: 1,
      position: undefined,
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };

    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;
    onEntityEvent({ type: "update", entity, changed: ["health"] }, events, log);

    expect(events.drain()).toHaveLength(0);
    expect(append).not.toHaveBeenCalled();
  });

  test("swallows entity event log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log: SessionLog = { append } as unknown as SessionLog;

    onEntityEvent(
      { type: "disappear", guid: 1n, name: "Gone NPC" },
      events,
      log,
    );
    await Promise.resolve();

    expect(append).toHaveBeenCalled();
  });
});

describe("onFriendEvent", () => {
  test("pushes friend-online event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onFriendEvent(
      {
        type: "friend-online",
        friend: {
          guid: 1n,
          name: "Arthas",
          note: "",
          status: FriendStatus.ONLINE,
          area: 0,
          level: 80,
          playerClass: 6,
        },
      },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("Arthas");
    expect(drained[0]!.text).toContain("online");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("FRIEND_ONLINE");
    expect(json.name).toBe("Arthas");
    expect(append).toHaveBeenCalledTimes(1);
  });

  test("pushes friend-offline event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onFriendEvent(
      { type: "friend-offline", guid: 1n, name: "Arthas" },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("Arthas");
    expect(drained[0]!.text).toContain("offline");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("FRIEND_OFFLINE");
  });

  test("skips friend-list events", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onFriendEvent({ type: "friend-list", friends: [] }, events, log);

    expect(events.drain()).toHaveLength(0);
    expect(append).not.toHaveBeenCalled();
  });

  test("pushes friend-error event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onFriendEvent(
      { type: "friend-error", result: 0x04, name: "Nobody" },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("player not found");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("FRIEND_ERROR");
    expect(json.result).toBe(0x04);
  });

  test("swallows friend event log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log: SessionLog = { append } as unknown as SessionLog;

    onFriendEvent(
      { type: "friend-offline", guid: 1n, name: "Gone" },
      events,
      log,
    );
    await Promise.resolve();

    expect(append).toHaveBeenCalled();
  });
});

describe("onIgnoreEvent", () => {
  test("pushes ignore-added event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onIgnoreEvent(
      { type: "ignore-added", entry: { guid: 1n, name: "Spammer" } },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("Spammer");
    expect(drained[0]!.text).toContain("added to ignore list");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("IGNORE_ADDED");
    expect(json.name).toBe("Spammer");
    expect(append).toHaveBeenCalledTimes(1);
  });

  test("pushes ignore-removed event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onIgnoreEvent(
      { type: "ignore-removed", guid: 1n, name: "Spammer" },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("Spammer");
    expect(drained[0]!.text).toContain("removed from ignore list");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("IGNORE_REMOVED");
  });

  test("skips ignore-list events", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onIgnoreEvent({ type: "ignore-list", entries: [] }, events, log);

    expect(events.drain()).toHaveLength(0);
    expect(append).not.toHaveBeenCalled();
  });

  test("pushes ignore-error event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onIgnoreEvent(
      { type: "ignore-error", result: 0x0d, name: "Nobody" },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("player not found");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("IGNORE_ERROR");
    expect(json.result).toBe(0x0d);
  });

  test("swallows ignore event log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log: SessionLog = { append } as unknown as SessionLog;

    onIgnoreEvent(
      { type: "ignore-removed", guid: 1n, name: "Gone" },
      events,
      log,
    );
    await Promise.resolve();

    expect(append).toHaveBeenCalled();
  });
});

describe("onGuildEvent", () => {
  test("pushes guild-roster event to ring buffer", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(async () => {});
    const log = { append } as unknown as SessionLog;

    onGuildEvent(
      {
        type: "guild-roster",
        roster: {
          guildName: "Horde Elite",
          motd: "Welcome!",
          guildInfo: "",
          rankNames: ["GM"],
          members: [
            {
              guid: 1n,
              name: "Thrall",
              rankIndex: 0,
              level: 80,
              playerClass: 7,
              gender: 0,
              area: 10,
              status: 1,
              timeOffline: 0,
              publicNote: "",
              officerNote: "",
            },
          ],
        },
      },
      events,
      log,
    );

    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("Roster updated");
    expect(drained[0]!.text).toContain("1 members");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("GUILD_ROSTER_UPDATED");
    expect(append).toHaveBeenCalledTimes(1);
  });

  test("swallows guild event log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log = { append } as unknown as SessionLog;

    onGuildEvent(
      {
        type: "guild-roster",
        roster: {
          guildName: "",
          motd: "",
          guildInfo: "",
          rankNames: [],
          members: [],
        },
      },
      events,
      log,
    );
    await Promise.resolve();

    expect(append).toHaveBeenCalled();
  });

  test("promotion formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      {
        type: "promotion",
        officer: "Thrall",
        member: "Garrosh",
        rank: "Officer",
      },
      events,
      log,
    );
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Thrall promoted Garrosh to Officer");
    expect(JSON.parse(d[0]!.json)).toEqual({
      type: "GUILD_PROMOTION",
      officer: "Thrall",
      member: "Garrosh",
      rank: "Officer",
    });
  });

  test("demotion formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      {
        type: "demotion",
        officer: "Thrall",
        member: "Garrosh",
        rank: "Member",
      },
      events,
      log,
    );
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Thrall demoted Garrosh to Member");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_DEMOTION");
  });

  test("motd formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "motd", text: "Raid tonight!" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] MOTD: Raid tonight!");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_MOTD");
  });

  test("joined formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "joined", name: "Arthas" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Arthas has joined the guild");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_JOINED");
  });

  test("left formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "left", name: "Sylvanas" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Sylvanas has left the guild");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_LEFT");
  });

  test("removed formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      { type: "removed", member: "Garrosh", officer: "Thrall" },
      events,
      log,
    );
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Thrall removed Garrosh from the guild");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_REMOVED");
  });

  test("leader_is formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "leader_is", name: "Thrall" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Thrall is the guild leader");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_LEADER_IS");
  });

  test("leader_changed formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      { type: "leader_changed", oldLeader: "Thrall", newLeader: "Garrosh" },
      events,
      log,
    );
    const d = events.drain();
    expect(d[0]!.text).toBe(
      "[guild] Thrall has made Garrosh the new guild leader",
    );
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_LEADER_CHANGED");
  });

  test("disbanded formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "disbanded" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Guild has been disbanded");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_DISBANDED");
  });

  test("signed_on formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "signed_on", name: "Jaina" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Jaina has come online");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_SIGNED_ON");
  });

  test("signed_off formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent({ type: "signed_off", name: "Varian" }, events, log);
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Varian has gone offline");
    expect(JSON.parse(d[0]!.json).type).toBe("GUILD_SIGNED_OFF");
  });

  test("command_result formats error text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      { type: "command_result", command: 1, name: "Thrall", result: 0x03 },
      events,
      log,
    );
    const d = events.drain();
    expect(d[0]!.text).toBe("[guild] Thrall is already in a guild");
    const json = JSON.parse(d[0]!.json);
    expect(json.type).toBe("GUILD_COMMAND_RESULT");
    expect(json.command).toBe(1);
    expect(json.name).toBe("Thrall");
    expect(json.result).toBe(0x03);
  });

  test("guild_invite formats text and JSON", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = { append: jest.fn(async () => {}) } as unknown as SessionLog;
    onGuildEvent(
      { type: "guild_invite", inviter: "Thrall", guildName: "Horde Heroes" },
      events,
      log,
    );
    const d = events.drain();
    expect(d[0]!.text).toBe(
      "[guild] Thrall has invited you to join Horde Heroes. Use /gaccept or /gdecline",
    );
    const json = JSON.parse(d[0]!.json);
    expect(json.type).toBe("GUILD_INVITE_RECEIVED");
    expect(json.inviter).toBe("Thrall");
    expect(json.guildName).toBe("Horde Heroes");
  });
});

describe("IPC round-trip", () => {
  let sockCounter = 0;
  let sockPath: string;
  let handle: ControlMock;
  let result: ReturnType<typeof startDaemonServer>;
  let exitSpy: ReturnType<typeof jest.fn>;

  function startTestServer(opts?: { onActivity?: () => void }) {
    sockPath = `./tmp/test-daemon-${++sockCounter}-${Date.now()}.sock`;
    handle = attachControl(createMockHandle());
    const log = new SessionLog(`./tmp/test-daemon-${sockCounter}.jsonl`);
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    result = startDaemonServer({ handle, sock: sockPath, log, ...opts });
  }

  afterEach(async () => {
    exitSpy?.mockRestore();
    result?.cleanup();
  });

  test("STATUS returns CONNECTED", async () => {
    startTestServer();
    const lines = await sendToSocket("STATUS", sockPath);
    expect(lines).toEqual(["CONNECTED"]);
  });

  test("SAY returns OK and calls handle", async () => {
    startTestServer();
    const lines = await sendToSocket("SAY hello world", sockPath);
    expect(lines).toEqual(["OK"]);
    expect(handle.sendSay).toHaveBeenCalledWith("hello world");
  });

  test("EMOTE returns OK and calls handle", async () => {
    startTestServer();
    const lines = await sendToSocket("EMOTE waves hello", sockPath);
    expect(lines).toEqual(["OK"]);
    expect(handle.sendEmote).toHaveBeenCalledWith("waves hello");
  });

  test("DND returns OK and calls handle", async () => {
    startTestServer();
    const lines = await sendToSocket("DND busy right now", sockPath);
    expect(lines).toEqual(["OK"]);
    expect(handle.sendDnd).toHaveBeenCalledWith("busy right now");
  });

  test("AFK returns OK and calls handle", async () => {
    startTestServer();
    const lines = await sendToSocket("AFK grabbing coffee", sockPath);
    expect(lines).toEqual(["OK"]);
    expect(handle.sendAfk).toHaveBeenCalledWith("grabbing coffee");
  });

  test("WHISPER returns OK", async () => {
    startTestServer();
    const lines = await sendToSocket("WHISPER Xiara hey", sockPath);
    expect(lines).toEqual(["OK"]);
    expect(handle.sendWhisper).toHaveBeenCalledWith("Xiara", "hey");
  });

  test("ROLL returns OK and calls sendRoll", async () => {
    startTestServer();
    const lines = await sendToSocket("ROLL 10 20", sockPath);
    expect(lines).toEqual(["OK"]);
    expect(handle.sendRoll).toHaveBeenCalledWith(10, 20);
  });

  test("READ returns buffered events", async () => {
    startTestServer();
    result.events.push({ text: "[say] Alice: hi", json: '{"type":"SAY"}' });
    result.events.push({ text: "[say] Bob: hey", json: '{"type":"SAY"}' });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines).toEqual(["[say] Alice: hi", "[say] Bob: hey"]);
  });

  test("bare text sends via sticky mode", async () => {
    startTestServer();
    const lines = await sendToSocket("hello world", sockPath);
    expect(lines[0]).toMatch(/^OK /);
    expect(handle.sendInCurrentMode).toHaveBeenCalledWith("hello world");
  });

  test("empty command returns ERR", async () => {
    startTestServer();
    const lines = await sendToSocket("", sockPath);
    expect(lines).toEqual(["ERR unknown command"]);
  });

  test("sendToSocket rejects on missing socket", async () => {
    await expect(
      sendToSocket("STATUS", "./tmp/nonexistent.sock"),
    ).rejects.toThrow();
  });

  test("onActivity fires on each IPC command", async () => {
    const activity = jest.fn();
    startTestServer({ onActivity: activity });
    await sendToSocket("STATUS", sockPath);
    await sendToSocket("STATUS", sockPath);
    expect(activity).toHaveBeenCalledTimes(2);
  });

  test("cleanup closes handle and stops server", async () => {
    startTestServer();
    await sendToSocket("STATUS", sockPath);
    result.cleanup();
    expect(handle.close).toHaveBeenCalled();
    await expect(sendToSocket("STATUS", sockPath)).rejects.toThrow();
  });

  test("cleanup is idempotent", async () => {
    startTestServer();
    result.cleanup();
    result.cleanup();
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  test("cleanup ignores missing socket file", async () => {
    startTestServer();
    await sendToSocket("STATUS", sockPath);
    await unlink(sockPath);
    result.cleanup();
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  test("STOP triggers process.exit", async () => {
    startTestServer();
    const lines = await sendToSocket("STOP", sockPath);
    expect(lines).toEqual(["OK"]);
    await Bun.sleep(0);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test("HALT stays connected while STOP exits", async () => {
    startTestServer();
    const haltLines = await sendToSocket("HALT", sockPath);
    expect(haltLines).toEqual(["OK"]);
    expect(handle.halt).toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    const status = await sendToSocket("STATUS", sockPath);
    expect(status).toEqual(["CONNECTED"]);
    const stopLines = await sendToSocket("STOP", sockPath);
    expect(stopLines).toEqual(["OK"]);
    await Bun.sleep(0);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test("malformed MOVE does not start movement", async () => {
    startTestServer();
    const lines = await sendToSocket("MOVE up", sockPath);
    expect(lines[0]?.startsWith("ERR")).toBe(true);
    expect(handle.move).not.toHaveBeenCalled();
  });

  test("HALT preempts coalesced READ_WAIT and drops older MOVE", async () => {
    startTestServer();
    await sendToSocket("MOVE forward 10000", sockPath);
    handle.move.mockClear();
    const started = Date.now();
    const lines = await sendRawCommands(sockPath, [
      "READ_WAIT 8000\nMOVE left 1000\nHALT\n",
    ]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(handle.halt).toHaveBeenCalled();
    expect(handle.move).not.toHaveBeenCalled();
    expect(lines).toContain("OK");
  });

  test("HALT drops older CAST and keeps later GOTO", async () => {
    startTestServer();
    const lines = await sendRawUntilClose(sockPath, [
      "CAST 585 0xa\nHALT\nGOTO 1 2 3\n",
    ]);
    expect(handle.cast).not.toHaveBeenCalled();
    expect(handle.halt).toHaveBeenCalled();
    expect(handle.goTo).toHaveBeenCalledWith(1, 2, 3);
    expect(lines).toContain("OK");
  });

  test("HALT drops older FOLLOW but preserves a newer follow request", async () => {
    startTestServer();
    const requested: bigint[] = [];
    Object.assign(handle, {
      follow: (guid: bigint) => {
        requested.push(guid);
      },
    });
    const lines = await sendRawUntilClose(sockPath, [
      "FOLLOW 1 3\nHALT\nFOLLOW 2 4\n",
    ]);
    expect(requested).toEqual([2n]);
    expect(lines).toEqual(["OK", "OK"]);
  });

  test("HALT drops older CYCLE", async () => {
    startTestServer();
    const lines = await sendRawUntilClose(sockPath, ["CYCLE 0xa\nHALT\n"]);
    expect(handle.startCycle).not.toHaveBeenCalled();
    expect(handle.halt).toHaveBeenCalled();
    expect(lines).toEqual(["OK"]);
  });

  test("HALT drops older recovery mutations but retains a corpse query and newer response", async () => {
    startTestServer();
    const actions: string[] = [];
    Object.assign(handle, {
      queryCorpse: () => {
        actions.push("query");
      },
      releaseSpirit: () => {
        actions.push("release");
      },
      reclaimCorpse: () => {
        actions.push("reclaim");
      },
      respondResurrection: (accept: boolean) => {
        actions.push(accept ? "accept" : "decline");
      },
    });
    await sendRawUntilClose(sockPath, [
      "RELEASE_SPIRIT\nRECLAIM_CORPSE\nRESURRECT accept\nQUERY_CORPSE\nHALT\nRESURRECT decline\n",
    ]);
    expect(actions).toEqual(["query", "decline"]);
  });

  test("gossip JSON code cannot inject a second IPC command", async () => {
    startTestServer();
    const codes: Array<string | undefined> = [];
    Object.assign(handle, {
      selectGossipOption: (_id: number, code?: string) => {
        codes.push(code);
      },
    });
    const code = '  say "hello"\nHALT\r\n  ';
    const lines = await sendToSocket(
      `SELECT_OPTION 0 ${JSON.stringify(code)}`,
      sockPath,
    );
    expect(lines).toEqual(["OK"]);
    expect(codes).toEqual([code]);
    expect(handle.halt).not.toHaveBeenCalled();
  });

  test("HALT drops old quest mutations but retains metadata and a new cancel", async () => {
    startTestServer();
    const actions: string[] = [];
    Object.assign(handle, {
      talk: () => {
        actions.push("talk");
      },
      selectGossipOption: () => {
        actions.push("option");
      },
      selectQuest: () => {
        actions.push("select");
      },
      acceptQuest: () => {
        actions.push("accept");
      },
      completeQuest: () => {
        actions.push("complete");
      },
      requestQuestReward: () => {
        actions.push("request_reward");
      },
      chooseQuestReward: () => {
        actions.push("choose_reward");
      },
      abandonQuest: () => {
        actions.push("abandon");
      },
      cancelInteraction: () => {
        actions.push("cancel");
      },
      queryQuest: () => {
        actions.push("query");
      },
    });
    await sendRawUntilClose(sockPath, [
      "TALK 1\nSELECT_OPTION 0 null\nSELECT_QUEST 1\nACCEPT_QUEST\nCOMPLETE_QUEST 1\nREQUEST_REWARD\nCHOOSE_REWARD 0\nABANDON_QUEST 0\nCANCEL_INTERACTION\nQUERY_QUEST 1\nHALT\nCANCEL_INTERACTION\n",
    ]);
    expect(actions).toEqual(["query", "cancel"]);
  });

  test("HALT drops older loot mutations and keeps a newer open", async () => {
    startTestServer();
    const actions: string[] = [];
    Object.assign(handle, {
      openLoot: (guid: bigint) => {
        actions.push(`open:${guid}`);
      },
      takeLoot: () => {
        actions.push("take");
      },
      takeLootMoney: () => {
        actions.push("money");
      },
      releaseLoot: () => {
        actions.push("release");
      },
      getInventoryState: () => {
        actions.push("inventory");
        return { status: "unknown" };
      },
    });
    await sendRawUntilClose(sockPath, [
      "OPEN_LOOT 1\nTAKE_LOOT 0\nTAKE_MONEY\nRELEASE_LOOT\nINVENTORY_JSON\nHALT\nOPEN_LOOT 2\n",
    ]);
    expect(actions).toEqual(["inventory", "open:2"]);
  });

  test("HALT preempts READ_WAIT arriving in a later chunk", async () => {
    startTestServer();
    await sendToSocket("MOVE forward 10000", sockPath);
    const started = Date.now();
    const lines = await sendRawCommands(
      sockPath,
      ["READ_WAIT 8000\n", "HALT\n"],
      20,
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(handle.halt).toHaveBeenCalled();
    expect(lines).toContain("OK");
  });

  test("HALT stops control before an unresolved WHO resolves", async () => {
    startTestServer();
    await sendToSocket("MOVE forward 10000", sockPath);
    handle.move.mockClear();
    const halted = Promise.withResolvers<void>();
    handle.halt.mockImplementation(() => {
      halted.resolve();
    });
    const pendingWho = Promise.withResolvers<never[]>();
    (handle.who as ReturnType<typeof jest.fn>).mockImplementation(
      () => pendingWho.promise,
    );
    const started = Date.now();
    const linesPromise = sendRawCommands(
      sockPath,
      ["WHO\n", "MOVE left 1000\nHALT\n"],
      20,
    );
    await Promise.race([
      halted.promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("halt not observed")), 2000);
      }),
    ]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(handle.move).not.toHaveBeenCalled();
    pendingWho.resolve([]);
    const lines = await linesPromise;
    expect(lines).toContain("OK");
    expect(handle.move).not.toHaveBeenCalled();
  });

  test("HALT keeps STATUS after held WHO without ERR internal", async () => {
    startTestServer();
    await sendToSocket("MOVE forward 10000", sockPath);
    handle.move.mockClear();
    const halted = Promise.withResolvers<void>();
    handle.halt.mockImplementation(() => {
      halted.resolve();
    });
    const pendingWho = Promise.withResolvers<never[]>();
    (handle.who as ReturnType<typeof jest.fn>).mockImplementation(
      () => pendingWho.promise,
    );
    const linesPromise = sendRawUntilClose(
      sockPath,
      ["WHO\n", "MOVE left 1000\nHALT\nSTATUS\n"],
      20,
    );
    await Promise.race([
      halted.promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("halt not observed")), 2000);
      }),
    ]);
    expect(handle.move).not.toHaveBeenCalled();
    pendingWho.resolve([]);
    const lines = await linesPromise;
    expect(lines).toContain("OK");
    expect(lines).toContain("CONNECTED");
    expect(lines.some((line) => line.includes("ERR internal"))).toBe(false);
    expect(handle.move).not.toHaveBeenCalled();
  });

  test("HALT keeps a newer FACE after held WHO", async () => {
    startTestServer();
    await sendToSocket("MOVE forward 10000", sockPath);
    handle.move.mockClear();
    const halted = Promise.withResolvers<void>();
    handle.halt.mockImplementation(() => {
      halted.resolve();
    });
    const pendingWho = Promise.withResolvers<never[]>();
    (handle.who as ReturnType<typeof jest.fn>).mockImplementation(
      () => pendingWho.promise,
    );
    const linesPromise = sendRawUntilClose(
      sockPath,
      ["WHO\n", "MOVE left 1000\nHALT\nSTATUS\nFACE 1\n"],
      20,
    );
    await Promise.race([
      halted.promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("halt not observed")), 2000);
      }),
    ]);
    pendingWho.resolve([]);
    const lines = await linesPromise;
    expect(lines).toContain("CONNECTED");
    expect(lines.some((line) => line.includes("ERR internal"))).toBe(false);
    expect(handle.face).toHaveBeenCalledWith(1);
    expect(handle.move).not.toHaveBeenCalled();
  });

  async function runMain(args: string[]) {
    const xdg = `${process.cwd()}/tmp/cli-main-${++sockCounter}-${Date.now()}`;
    await mkdir(`${xdg}/tuicraft`, { recursive: true });
    sockPath = `${xdg}/tuicraft/sock`;
    const log = new SessionLog(`${xdg}/session.jsonl`);
    exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    result = startDaemonServer({ handle, sock: sockPath, log });
    const proc = Bun.spawn({
      cmd: [process.execPath, `${import.meta.dir}/../main.ts`, ...args],
      cwd: `${import.meta.dir}/../..`,
      env: { ...process.env, XDG_RUNTIME_DIR: xdg },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, out, error] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code, out, error };
  }

  test("MOVE ERR exits nonzero from src/main.ts", async () => {
    handle = attachControl(createMockHandle());
    handle.move.mockImplementation(() => {
      throw new Error("rooted");
    });
    const { code, out } = await runMain(["move", "forward"]);
    expect(code).toBe(1);
    expect(out).toContain("ERR rooted");
  });

  test("spellbook inspection errors exit nonzero from the CLI", async () => {
    handle = attachControl(createMockHandle());
    handle.getSpellbook.mockImplementation(async () => {
      throw new Error("missing_spell_data");
    });
    const { code, out } = await runMain(["spells", "--json"]);
    expect(code).toBe(1);
    expect(out.startsWith("ERR ")).toBe(true);
  });

  test("start reports already running if daemon is active", async () => {
    handle = attachControl(createMockHandle());
    const { code, out } = await runMain(["start"]);
    expect(code).toBe(0);
    expect(out.trim()).toBe("Daemon is already running.");
  });

  test("multiline fight instructions cannot execute injected controls", async () => {
    handle = attachControl(createMockHandle());
    const startTactics = jest.fn(async () => {});
    handle.startTactics = startTactics;
    const { code } = await runMain([
      "fight",
      "0xa",
      "stay alive\nMOVE forward 10000",
    ]);
    expect(handle.move).not.toHaveBeenCalled();
    expect(startTactics).not.toHaveBeenCalled();
    expect(code).toBe(1);
  });

  test("MOVE FACE TARGET round-trip call handle", async () => {
    startTestServer();
    expect(await sendToSocket("MOVE right 2000", sockPath)).toEqual(["OK"]);
    expect(handle.move).toHaveBeenCalledWith("right", 2000);
    expect(await sendToSocket("FACE 0.25", sockPath)).toEqual(["OK"]);
    expect(handle.face).toHaveBeenCalledWith(0.25);
    expect(await sendToSocket("TARGET 0xa", sockPath)).toEqual(["OK"]);
    expect(handle.selectTarget).toHaveBeenCalledWith(0xan);
  });

  test("CONTROL_JSON round-trip keeps pose provenance", async () => {
    startTestServer();
    handle.getControlState.mockReturnValue(sampleState());
    const lines = await sendToSocket("CONTROL_JSON", sockPath);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.pose.source).toBe("predicted");
    expect(parsed.serverPose.source).toBe("server");
    expect(parsed.selfGuid).toBe("0xabcde");
  });

  test("control events reach the ring buffer", async () => {
    startTestServer();
    const cb = handle.onControlEvent.mock.calls[0]![0] as (
      event: ControlEvent,
    ) => void;
    cb({ type: "movement_started", state: sampleState() });
    const jsonLines = await sendToSocket("READ_JSON", sockPath);
    const parsed = JSON.parse(jsonLines[0]!);
    expect(parsed.type).toBe("CONTROL");
    expect(parsed.event).toBe("movement_started");
    expect(parsed.pose.source).toBe("predicted");
  });

  test("buffers split command chunks before parsing", async () => {
    const origListen = Bun.listen;
    let capturedData:
      | ((
          socket: {
            write(data: string | Uint8Array): number;
            end(): void;
          },
          data: ArrayBuffer | ArrayBufferView,
        ) => void | Promise<void>)
      | undefined;
    let stopFn: ReturnType<typeof jest.fn> | undefined;

    Bun.listen = jest.fn((opts: { socket: { data: typeof capturedData } }) => {
      capturedData = opts.socket.data;
      stopFn = jest.fn();
      return { stop: stopFn } as unknown as ReturnType<typeof Bun.listen>;
    }) as unknown as typeof Bun.listen;

    try {
      const handle = attachControl(createMockHandle());
      const log = new SessionLog(`./tmp/test-daemon-split-${Date.now()}.jsonl`);
      const { cleanup } = startDaemonServer({
        handle,
        sock: `./tmp/test-daemon-split-${Date.now()}.sock`,
        log,
      });
      const socket = createMockSocket();

      capturedData!(socket, Buffer.from("STA"));
      capturedData!(socket, Buffer.from("TUS\n"));
      await Promise.resolve();

      expect(socket.written()).toBe("CONNECTED\n\n");

      cleanup();
      expect(stopFn).toHaveBeenCalled();
    } finally {
      Bun.listen = origListen;
    }
  });

  test("keeps a split next command after a completed command", async () => {
    const origListen = Bun.listen;
    let capturedData:
      | ((
          socket: {
            write(data: string | Uint8Array): number;
            end(): void;
          },
          data: ArrayBuffer | ArrayBufferView,
        ) => void | Promise<void>)
      | undefined;
    let stopFn: ReturnType<typeof jest.fn> | undefined;

    Bun.listen = jest.fn((opts: { socket: { data: typeof capturedData } }) => {
      capturedData = opts.socket.data;
      stopFn = jest.fn();
      return { stop: stopFn } as unknown as ReturnType<typeof Bun.listen>;
    }) as unknown as typeof Bun.listen;

    try {
      const handle = attachControl(createMockHandle());
      const log = new SessionLog(
        `./tmp/test-daemon-split-next-${Date.now()}.jsonl`,
      );
      const { cleanup } = startDaemonServer({
        handle,
        sock: `./tmp/test-daemon-split-next-${Date.now()}.sock`,
        log,
      });
      const socket = createMockSocket();

      capturedData!(socket, Buffer.from("STATUS\nSTA"));
      await Bun.sleep(0);
      expect(socket.written()).toBe("CONNECTED\n\n");

      capturedData!(socket, Buffer.from("TUS\n"));
      await Bun.sleep(0);
      expect(socket.written()).toBe("CONNECTED\n\nCONNECTED\n\n");

      cleanup();
      expect(stopFn).toHaveBeenCalled();
    } finally {
      Bun.listen = origListen;
    }
  });

  test("processes multiple commands from a single chunk", async () => {
    const origListen = Bun.listen;
    let capturedData:
      | ((
          socket: {
            write(data: string | Uint8Array): number;
            end(): void;
          },
          data: ArrayBuffer | ArrayBufferView,
        ) => void | Promise<void>)
      | undefined;
    let stopFn: ReturnType<typeof jest.fn> | undefined;

    Bun.listen = jest.fn((opts: { socket: { data: typeof capturedData } }) => {
      capturedData = opts.socket.data;
      stopFn = jest.fn();
      return { stop: stopFn } as unknown as ReturnType<typeof Bun.listen>;
    }) as unknown as typeof Bun.listen;

    try {
      const handle = attachControl(createMockHandle());
      const log = new SessionLog(`./tmp/test-daemon-multi-${Date.now()}.jsonl`);
      const { cleanup } = startDaemonServer({
        handle,
        sock: `./tmp/test-daemon-multi-${Date.now()}.sock`,
        log,
      });
      const socket = createMockSocket();

      capturedData!(socket, Buffer.from("STATUS\nSTATUS\n"));
      await Bun.sleep(0);

      expect(socket.written()).toBe("CONNECTED\n\nCONNECTED\n\n");

      cleanup();
      expect(stopFn).toHaveBeenCalled();
    } finally {
      Bun.listen = origListen;
    }
  });

  test("onMessage wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerMessage({
      type: ChatType.SAY,
      sender: "Alice",
      message: "hi",
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines).toEqual(["[say] Alice: hi"]);
  });

  test("onGroupEvent wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerGroupEvent({ type: "group_destroyed" });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines).toEqual(["[group] Group has been disbanded"]);
  });

  test("onFriendEvent wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerFriendEvent({
      type: "friend-online",
      friend: {
        guid: 1n,
        name: "Arthas",
        level: 80,
        playerClass: 1,
        area: 0,
        status: 0,
        note: "",
      },
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines[0]).toContain("Arthas");
  });

  test("onIgnoreEvent wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerIgnoreEvent({
      type: "ignore-added",
      entry: { guid: 1n, name: "Spammer" },
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines[0]).toContain("Spammer");
    expect(lines[0]).toContain("added to ignore list");
  });

  test("IGNORED round-trip returns empty list", async () => {
    startTestServer();
    const lines = await sendToSocket("IGNORED", sockPath);
    expect(lines).toEqual(["[ignore] Ignore list is empty"]);
  });

  test("onEntityEvent wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerEntityEvent({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Test NPC",
        level: 10,
        health: 100,
        maxHealth: 100,
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        factionTemplate: 0,
        displayId: 0,
        npcFlags: 0,
        unitFlags: 0,
        target: 0n,
        race: 0,
        class_: 0,
        gender: 0,
        power: [0, 0, 0, 0, 0, 0, 0],
        maxPower: [0, 0, 0, 0, 0, 0, 0],
      } satisfies UnitEntity,
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines[0]).toContain("Test NPC");
  });

  test("onEntityEvent wiring round-trip via READ_JSON", async () => {
    startTestServer();
    handle.triggerEntityEvent({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Test NPC",
        level: 10,
        health: 100,
        maxHealth: 100,
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        factionTemplate: 0,
        displayId: 0,
        npcFlags: 0,
        unitFlags: 0,
        target: 0n,
        race: 0,
        class_: 0,
        gender: 0,
        power: [0, 0, 0, 0, 0, 0, 0],
        maxPower: [0, 0, 0, 0, 0, 0, 0],
      } satisfies UnitEntity,
    });
    const lines = await sendToSocket("READ_JSON", sockPath);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.type).toBe("ENTITY_APPEAR");
    expect(parsed.name).toBe("Test NPC");
  });

  test("NEARBY round-trip returns formatted entities", async () => {
    startTestServer();
    const testUnit: UnitEntity = {
      guid: 1n,
      objectType: ObjectType.UNIT,
      name: "Thrall",
      level: 80,
      health: 5000,
      maxHealth: 5000,
      entry: 0,
      scale: 1,
      position: { mapId: 1, x: 1.23, y: 4.56, z: 7.89, orientation: 0 },
      rawFields: new Map(),
      factionTemplate: 0,
      displayId: 0,
      npcFlags: 0,
      unitFlags: 0,
      target: 0n,
      race: 0,
      class_: 0,
      gender: 0,
      power: [0, 0, 0, 0, 0, 0, 0],
      maxPower: [0, 0, 0, 0, 0, 0, 0],
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      testUnit,
    ]);
    const lines = await sendToSocket("NEARBY", sockPath);
    expect(lines[0]).toContain("Thrall");
    expect(lines[0]).toContain("level 80");
  });

  test("onGuildEvent wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerGuildEvent({
      type: "guild-roster",
      roster: {
        guildName: "Horde Elite",
        motd: "Welcome!",
        guildInfo: "",
        rankNames: ["GM"],
        members: [
          {
            guid: 1n,
            name: "Thrall",
            rankIndex: 0,
            level: 80,
            playerClass: 7,
            gender: 0,
            area: 10,
            status: 1,
            timeOffline: 0,
            publicNote: "",
            officerNote: "",
          },
        ],
      },
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines[0]).toContain("Roster updated");
  });

  test("GUILD_ROSTER round-trip with data", async () => {
    startTestServer();
    const roster = {
      guildName: "Horde Elite",
      motd: "Welcome!",
      guildInfo: "",
      rankNames: ["GM"],
      members: [
        {
          guid: 1n,
          name: "Thrall",
          rankIndex: 0,
          level: 80,
          playerClass: 7,
          gender: 0,
          area: 10,
          status: 1,
          timeOffline: 0,
          publicNote: "",
          officerNote: "",
        },
      ],
    };
    (handle.requestGuildRoster as ReturnType<typeof jest.fn>).mockResolvedValue(
      roster,
    );
    const lines = await sendToSocket("GUILD_ROSTER", sockPath);
    expect(lines[0]).toContain("Horde Elite");
    expect(lines.join("\n")).toContain("Thrall");
  });

  test("dispatch error returns ERR internal", async () => {
    startTestServer();
    (handle.who as ReturnType<typeof jest.fn>).mockRejectedValue(
      new Error("db fail"),
    );
    const lines = await sendToSocket("WHO", sockPath);
    expect(lines).toEqual(["ERR internal"]);
  });

  test("onDuelEvent wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerDuelEvent({
      type: "duel_requested",
      challenger: "Arthas",
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines).toEqual(["[duel] Arthas challenges you to a duel"]);
  });
});

describe("onDuelEvent", () => {
  test("duel_requested formats with challenger name", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ type: "duel_requested", challenger: "Arthas" }, events, log);
    const entries = events.drain();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe("[duel] Arthas challenges you to a duel");
    expect(JSON.parse(entries[0]!.json)).toEqual({
      type: "DUEL_REQUESTED",
      challenger: "Arthas",
    });
  });

  test("duel_countdown formats with seconds", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ type: "duel_countdown", timeMs: 3000 }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBe("[duel] Duel starting in 3 seconds");
  });

  test("duel_winner won formats correctly", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent(
      {
        type: "duel_winner",
        reason: "won",
        winner: "Thrall",
        loser: "Garrosh",
      },
      events,
      log,
    );
    const entries = events.drain();
    expect(entries[0]!.text).toBe(
      "[duel] Thrall has defeated Garrosh in a duel",
    );
  });

  test("duel_winner fled formats correctly", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent(
      {
        type: "duel_winner",
        reason: "fled",
        winner: "Thrall",
        loser: "Garrosh",
      },
      events,
      log,
    );
    const entries = events.drain();
    expect(entries[0]!.text).toBe(
      "[duel] Garrosh has fled from Thrall in a duel",
    );
  });

  test("duel_out_of_bounds formats warning", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ type: "duel_out_of_bounds" }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBe(
      "[duel] Out of bounds \u2014 return to the duel area",
    );
  });

  test("duel_in_bounds formats notice", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ type: "duel_in_bounds" }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBe("[duel] Back in bounds");
  });

  test("duel_complete completed=true is silent text", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ type: "duel_complete", completed: true }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBeUndefined();
    expect(JSON.parse(entries[0]!.json)).toEqual({
      type: "DUEL_COMPLETE",
      completed: true,
    });
  });

  test("duel_complete completed=false shows interrupted", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent({ type: "duel_complete", completed: false }, events, log);
    const entries = events.drain();
    expect(entries[0]!.text).toBe("[duel] Duel interrupted");
  });

  test("swallows duel event log append errors", async () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.reject(new Error("disk full")));
    const log = { append } as unknown as SessionLog;
    onDuelEvent({ type: "duel_in_bounds" }, events, log);
    await Promise.resolve();
    expect(append).toHaveBeenCalled();
  });

  test("duel JSON objects include all fields", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    onDuelEvent(
      {
        type: "duel_winner",
        reason: "won",
        winner: "A",
        loser: "B",
      },
      events,
      log,
    );
    const json = JSON.parse(events.drain()[0]!.json);
    expect(json).toEqual({
      type: "DUEL_WINNER",
      reason: "won",
      winner: "A",
      loser: "B",
    });
  });
});

describe("onControlEvent", () => {
  test("pushes event to ring and session log with hex ids", () => {
    const events = new RingBuffer<EventEntry>(10);
    const append = jest.fn(() => Promise.resolve());
    const log = { append } as unknown as SessionLog;
    onControlEvent(
      { type: "target_requested", state: sampleState(), reason: "select" },
      events,
      log,
    );
    const drained = events.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.text).toContain("[control]");
    expect(drained[0]!.text).toContain("predicted");
    const json = JSON.parse(drained[0]!.json);
    expect(json.type).toBe("CONTROL");
    expect(json.event).toBe("target_requested");
    expect(json.selfGuid).toBe("0xabcde");
    expect(json.target).toBe("0xa");
    expect(json.pose.source).toBe("predicted");
    expect(json.serverPose.source).toBe("server");
    expect(append).toHaveBeenCalledTimes(1);
  });

  test("server correction keeps server pose labelled server", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    const state = sampleState({
      pose: {
        mapId: 530,
        x: 1,
        y: 2,
        z: 3,
        orientation: 0,
        source: "server",
        updatedAt: 5,
      },
    });
    onControlEvent({ type: "server_correction", state }, events, log);
    const entry = events.drain()[0]!;
    expect(JSON.parse(entry.json).pose.source).toBe("server");
    expect(entry.text).toContain("server");
  });
});

describe("follow IPC boundary", () => {
  test("parses optional finite standoff and exact unsigned GUIDs", () => {
    expect(parseIpcCommand("FOLLOW 18446744073709551615")).toEqual({
      type: "follow",
      guid: 0xffff_ffff_ffff_ffffn,
      distance: undefined,
    });
    expect(parseIpcCommand("FOLLOW 0xabc 2.5")).toEqual({
      type: "follow",
      guid: 0xabcn,
      distance: 2.5,
    });
    expect(parseIpcCommand("FOLLOWING")).toEqual({ type: "following" });
    expect(parseIpcCommand("FOLLOWING_JSON")).toEqual({
      type: "following_json",
    });
  });

  test("malformed follow is an error instead of a chat message or action", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      follow: () => {
        throw new Error("action_was_called");
      },
    });
    for (const line of [
      "FOLLOW",
      "FOLLOW 0",
      "FOLLOW -1",
      "FOLLOW 18446744073709551616",
      "FOLLOW 1 Infinity",
      "FOLLOW 1 0",
      "FOLLOW 1 21",
      "FOLLOW 1 3 extra",
    ]) {
      const command = parseIpcCommand(line)!;
      expect(command.type).toBe("invalid");
      const socket = createMockSocket();
      await dispatchCommand(
        command,
        handle,
        new RingBuffer<EventEntry>(10),
        socket,
        jest.fn(),
      );
      expect(socket.written()).toMatch(/^ERR /);
      expect(socket.written()).not.toContain("action_was_called");
    }
    expect(handle.sendInCurrentMode).not.toHaveBeenCalled();
  });

  test("follow rejection is ERR without an OK or arrival claim", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      follow: () => {
        throw new Error("target_motion_unknown");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "follow", guid: 1n },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(socket.written()).toBe("ERR target_motion_unknown\n\n");
  });

  test("following JSON preserves provenance and encodes uint64 identifiers", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getFollowState: (): FollowState => ({
        active: true,
        status: "following",
        guid: 0xffff_ffff_ffff_ffffn,
        distance: 3,
        separation: undefined,
        destination: undefined,
        startedAt: 1000,
        expiresAt: 31_000,
        plans: 1,
        targetPose: {
          x: 1,
          y: 2,
          z: 3,
          mapId: 530,
          orientation: 0,
          source: "predicted",
          updatedAt: 1100,
        },
        observedAt: 1000,
        attempts: 2,
        reason: undefined,
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "following_json" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    const state = JSON.parse(socket.written());
    expect(state.guid).toBe("0xffffffffffffffff");
    expect(state.status).toBe("following");
    expect(state.targetPose.source).toBe("predicted");
    expect(state.observedAt).toBe(1000);
    expect(state.targetPose.updatedAt).toBe(1100);
  });

  test("following inspection failure cannot be presented as an empty state", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getFollowState: () => {
        throw new Error("session_closed");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "following" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(socket.written()).toBe("ERR session_closed\n\n");
  });
});

describe("recovery IPC boundary", () => {
  test("requires exact recovery action syntax", () => {
    expect(parseIpcCommand("RECOVERY_JSON")).toEqual({ type: "recovery_json" });
    expect(parseIpcCommand("QUERY_CORPSE")).toEqual({ type: "query_corpse" });
    expect(parseIpcCommand("RESURRECT accept")).toEqual({
      type: "resurrect",
      accept: true,
    });
    expect(parseIpcCommand("RESURRECT decline")).toEqual({
      type: "resurrect",
      accept: false,
    });
    for (const line of [
      "QUERY_CORPSE 1",
      "RELEASE_SPIRIT now",
      "RECLAIM_CORPSE 0",
      "RESURRECT",
      "RESURRECT yes",
      "RESURRECT accept extra",
    ])
      expect(parseIpcCommand(line)?.type).toBe("invalid");
  });

  test("a recovery request acknowledgement does not claim a life transition", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      releaseSpirit: () => ({
        request: { action: "release", status: "unanswered" },
        life: "dead",
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "release_spirit" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(socket.written()).toBe("OK\n\n");
  });

  test("reclaim refusal is ERR without success", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      reclaimCorpse: () => {
        throw new Error("Cannot request reclaim: wrong_map");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "reclaim_corpse" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(socket.written()).toBe("ERR Cannot request reclaim: wrong_map\n\n");
  });

  test("recovery JSON preserves unknown timing, pose provenance and distinct corpse maps", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getRecoveryState: () => ({
        selfGuid: 0xffff_ffff_ffff_ffffn,
        life: "ghost",
        health: 1,
        corpse: {
          status: "found",
          mapId: 530,
          corpseMapId: 540,
          position: { x: 1, y: 2, z: 3 },
          observedAt: 1000,
        },
        reclaim: {
          canRequest: false,
          readiness: "blocked",
          remainingMs: undefined,
          pose: { source: "predicted", updatedAt: 1200 },
        },
        request: { action: "reclaim", timing: "unknown", status: "unanswered" },
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "recovery_json" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    const state = JSON.parse(socket.written());
    expect(state.selfGuid).toBe("0xffffffffffffffff");
    expect(state.life).toBe("ghost");
    expect(state.corpse.mapId).toBe(530);
    expect(state.corpse.corpseMapId).toBe(540);
    expect(state.reclaim.pose.source).toBe("predicted");
    expect(state.reclaim).not.toHaveProperty("remainingMs");
    expect(state.request.timing).toBe("unknown");
    expect(state.request.status).toBe("unanswered");
  });

  test("recovery inspection failures are not empty healthy state", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getRecoveryState: () => {
        throw new Error("session_closed");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "recovery" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(socket.written()).toBe("ERR session_closed\n\n");
  });
});

describe("cycle IPC boundary", () => {
  test("cycle dispatch starts the queue with parsed guids, instruction and max starts", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      startCycle: jest.fn(async () => {}),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      {
        type: "cycle",
        guids: [1n, 2n],
        instruction: "kill fast",
        maxStarts: 3,
      },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(handle.startCycle).toHaveBeenCalledWith([1n, 2n], "kill fast", 3);
    expect(socket.written()).toBe("OK\n\n");
  });

  test("cycle start rejection is ERR without an OK", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      startCycle: jest.fn(async () => {
        throw new Error("self_not_alive");
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "cycle", guids: [1n], instruction: "fight", maxStarts: 10 },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(socket.written()).toBe("ERR self_not_alive\n\n");
  });

  test("cycling reports the same snapshot the runtime exposes", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getCycleState: (): CycleState => ({
        active: true,
        phase: "fighting",
        queue: [{ guid: 1n, status: "queued" }],
        currentIndex: 0,
        instruction: "fight",
        maxStarts: 10,
        startsUsed: 1,
        stopCause: undefined,
        stopDetail: undefined,
        startedAt: 1000,
        lastLoot: undefined,
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "cycling_json" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    const state = JSON.parse(socket.written());
    expect(state.phase).toBe("fighting");
    expect(state.queue[0].guid).toBe("0x1");
    expect(state.startsUsed).toBe(1);
  });

  test("cycling inspection failure is ERR, not an empty phase", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getCycleState: () => {
        throw new Error("session_closed");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "cycling" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(socket.written()).toBe("ERR session_closed\n\n");
  });

  test("cycle events reach the ring buffer and session log", () => {
    const events = new RingBuffer<EventEntry>(10);
    const log = {
      append: jest.fn(() => Promise.resolve()),
    } as unknown as SessionLog;
    const state = createMockHandle().getCycleState();
    onCycleEvent({ type: "started", state, at: 1000 }, events, log);
    const drained = events.drain();
    expect(drained[0]!.text).toBe("[cycle] started");
    expect(JSON.parse(drained[0]!.json).type).toBe("CYCLE");
  });
});

describe("quest IPC boundary", () => {
  test("JSON gossip code preserves omitted, null, empty and whitespace values", () => {
    expect(parseIpcCommand("SELECT_OPTION 0")).toEqual({
      type: "select_option",
      optionId: 0,
      code: undefined,
    });
    expect(parseIpcCommand("SELECT_OPTION 0 null")).toEqual({
      type: "select_option",
      optionId: 0,
      code: undefined,
    });
    expect(parseIpcCommand('SELECT_OPTION 0 ""')).toEqual({
      type: "select_option",
      optionId: 0,
      code: "",
    });
    const code = '  hello "friend"\nHALT  ';
    expect(parseIpcCommand(`SELECT_OPTION 0 ${JSON.stringify(code)}`)).toEqual({
      type: "select_option",
      optionId: 0,
      code,
    });
  });

  test("rejects malformed gossip JSON, nonstrings, NUL and trailing tokens", () => {
    for (const code of [
      "raw text",
      "true",
      "3",
      "{}",
      "[]",
      '"ok" "extra"',
      '"unterminated',
      JSON.stringify("bad\0code"),
    ])
      expect(parseIpcCommand(`SELECT_OPTION 0 ${code}`)?.type).toBe("invalid");
    for (const line of [
      "TALK 0",
      "QUERY_QUEST 0",
      "SELECT_QUEST 4294967296",
      "COMPLETE_QUEST 1.5",
      "CHOOSE_REWARD 6",
      "ABANDON_QUEST 25",
      "ACCEPT_QUEST extra",
      "REQUEST_REWARD 0",
      "CANCEL_INTERACTION extra",
    ])
      expect(parseIpcCommand(line)?.type).toBe("invalid");
  });

  test("an unanswered interaction error cannot produce a success acknowledgement", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      acceptQuest: () => {
        throw new Error("quest_reply_unanswered");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "accept_quest" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(socket.written()).toBe("ERR quest_reply_unanswered\n\n");
  });

  test("quest JSON keeps unanswered metadata separate from accepted state", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getQuestState: () => ({
        giver: 0xffff_ffff_ffff_ffffn,
        queries: [{ questId: 42, status: "unanswered", sentAt: 1000 }],
        log: {
          complete: false,
          slots: [
            { slot: 0, questId: undefined, counters: [undefined, 1, 0, 0] },
          ],
        },
        pending: { action: "accept", questId: 42 },
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "quests_json" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    const state = JSON.parse(socket.written());
    expect(state.giver).toBe("0xffffffffffffffff");
    expect(state.queries[0].status).toBe("unanswered");
    expect(state.log.slots[0]).not.toHaveProperty("questId");
    expect(state.log.slots[0].counters).toEqual([null, 1, 0, 0]);
    expect(state.pending.action).toBe("accept");
  });
});

describe("loot IPC boundary", () => {
  test("uses nonzero uint64 targets and actual uint8 slot range", () => {
    expect(parseIpcCommand("OPEN_LOOT 18446744073709551615")).toEqual({
      type: "open_loot",
      guid: 0xffff_ffff_ffff_ffffn,
    });
    expect(parseIpcCommand("TAKE_LOOT 255")).toEqual({
      type: "take_loot",
      slot: 255,
    });
    for (const line of [
      "OPEN_LOOT 0",
      "OPEN_LOOT 18446744073709551616",
      "TAKE_LOOT -1",
      "TAKE_LOOT 256",
      "TAKE_LOOT 0 extra",
      "TAKE_MONEY extra",
      "RELEASE_LOOT 1",
    ])
      expect(parseIpcCommand(line)?.type).toBe("invalid");
  });

  test("unoffered loot is an error, not a success or chat action", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      takeLoot: () => {
        throw new Error("Loot slot was not offered");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "take_loot", slot: 0 },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(socket.written()).toBe("ERR Loot slot was not offered\n\n");
    expect(handle.sendInCurrentMode).not.toHaveBeenCalled();
  });

  test("release-only opening remains unanswered in serialized loot inspection", async () => {
    const guid = 0xffff_ffff_ffff_ffffn;
    const handle = Object.assign(attachControl(createMockHandle()), {
      getRewardsState: () => ({
        loot: { phase: "opening", guid, requestedAt: 1000 },
        pending: {
          action: "open",
          guid,
          status: "unanswered",
          requestedAt: 1000,
        },
        lastRelease: { guid, status: 1, observedAt: 1100 },
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "loot_json" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    const state = JSON.parse(socket.written());
    expect(state.loot.phase).toBe("opening");
    expect(state.pending.status).toBe("unanswered");
    expect(state.lastRelease.guid).toBe("0xffffffffffffffff");
    expect(state.lastRelease.status).toBe(1);
  });

  test("inventory serialization does not turn unknown counts or capacity into defaults", async () => {
    const guid = 0xffff_ffff_ffff_ffffn;
    const handle = Object.assign(attachControl(createMockHandle()), {
      getInventoryState: () => ({
        selfGuid: 1n,
        scope: "carried",
        status: "partial",
        coinage: undefined,
        freeSlots: undefined,
        slots: [
          {
            bag: 255,
            slot: 23,
            region: "backpack",
            status: "occupied",
            guid,
            item: { guid, count: undefined },
          },
        ],
        bags: [],
        issues: [],
      }),
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "inventory_json" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    const state = JSON.parse(socket.written());
    expect(state.slots[0].guid).toBe("0xffffffffffffffff");
    expect(state.slots[0].item).not.toHaveProperty("count");
    expect(state).not.toHaveProperty("coinage");
    expect(state).not.toHaveProperty("freeSlots");
  });

  test("loot inspection errors retain ERR semantics", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getRewardsState: () => {
        throw new Error("session_closed");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { type: "loot" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(socket.written()).toBe("ERR session_closed\n\n");
  });
});
