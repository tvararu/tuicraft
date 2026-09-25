import { afterEach, describe, expect, jest, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { sendToSocket } from "cli/ipc";
import { dispatchCommand, type EventEntry, writeLines } from "daemon/commands";
import { onDomainEvent } from "daemon/events";
import { parseIpcCommand } from "daemon/parse";
import { startDaemonServer } from "daemon/server";
import { RingBuffer } from "lib/ring-buffer";
import { SessionLog } from "lib/session-log";
import { createMockHandle } from "test/mock-handle";
import type { ControlEvent, ControlState } from "wow/control";
import type { CycleState } from "wow/encounter-cycle";
import type {
  BaseEntity,
  GameObjectEntity,
  UnitEntity,
} from "wow/entity-store";
import { ObjectType } from "wow/protocol/entity-fields";
import { ChatType } from "wow/protocol/opcodes";

function createMockSocket(): {
  write: ReturnType<typeof jest.fn>;
  end: ReturnType<typeof jest.fn>;
  written(): string;
} {
  const chunks: string[] = [];
  return {
    end: jest.fn(),
    write: jest.fn((data: string | Uint8Array) => {
      chunks.push(
        typeof data === "string" ? data : Buffer.from(data).toString(),
      );
      return (typeof data === "string" ? data : Buffer.from(data).toString())
        .length;
    }),
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
      socket: {
        close() {
          resolve(buffer.split("\n").filter((line) => line !== ""));
        },
        data(socket, data) {
          buffer += Buffer.from(data).toString();
          if (buffer.endsWith("\n\n") || buffer === "\n") {
            socket.end();
            resolve(buffer.split("\n").filter((line) => line !== ""));
          }
        },
        error(_socket, err) {
          reject(err);
        },
        async open(socket) {
          for (const [i, chunk] of chunks.entries()) {
            if (i > 0 && gapMs > 0) await Bun.sleep(gapMs);
            socket.write(chunk);
            socket.flush();
          }
        },
      },
      unix: path,
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
      socket: {
        close() {
          resolve(buffer.split("\n").filter((line) => line !== ""));
        },
        data(_socket, data) {
          buffer += Buffer.from(data).toString();
        },
        error(_socket, err) {
          reject(err);
        },
        async open(socket) {
          for (const [i, chunk] of chunks.entries()) {
            if (i > 0 && gapMs > 0) await Bun.sleep(gapMs);
            socket.write(chunk);
            socket.flush();
          }
        },
      },
      unix: path,
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
    attack: jest.fn(),
    cancelCast: jest.fn(),
    cast: jest.fn(),
    face: jest.fn(),
    getCombatState: jest.fn(() => ({})),
    getControlState: jest.fn(
      (): ControlState => ({
        blockedReason: undefined,
        direction: undefined,
        movementAllowed: true,
        moving: false,
        owner: "none",
        pose: undefined,
        requestedTarget: undefined,
        selfGuid: 1n,
        serverPose: undefined,
        speed: 0,
        target: undefined,
      }),
    ),
    getNavigationState: jest.fn(() => ({})),
    getSpellbook: jest.fn(async () => []),
    getTacticsState: jest.fn(() => ({})),
    goTo: jest.fn(),
    halt: jest.fn(),
    move: jest.fn(),
    onCombatEvent: jest.fn(),
    onControlEvent: jest.fn(),
    onTacticsEvent: jest.fn(),
    selectTarget: jest.fn(),
    startTactics: jest.fn(async () => {}),
    stopAttack: jest.fn(),
  });
  return handle as ControlMock;
}

function sampleState(overrides: Partial<ControlState> = {}): ControlState {
  return {
    blockedReason: undefined,
    direction: "forward",
    movementAllowed: true,
    moving: true,
    owner: "manual",
    pose: {
      mapId: 530,
      orientation: 1.5,
      source: "predicted",
      updatedAt: 1000,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
    },
    requestedTarget: 0xan,
    selfGuid: 0xabcden,
    serverPose: {
      mapId: 530,
      orientation: 1.57,
      source: "server",
      updatedAt: 900,
      x: 8709.46,
      y: -6671.76,
      z: 70.34,
    },
    speed: 7,
    target: 0xan,
    ...overrides,
  };
}

describe("dispatchCommand", () => {
  test("say calls sendSay and writes OK", async () => {
    const handle = createMockHandle();
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    const result = await dispatchCommand(
      { message: "hello", type: "say" },
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
      { message: "HEY", type: "yell" },
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
      { message: "inv pls", type: "guild" },
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
      { message: "pull", type: "party" },
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
      { message: "waves hello", type: "emote" },
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
      { message: "busy", type: "dnd" },
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
      { message: "grabbing coffee", type: "afk" },
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
      { max: 100, min: 1, type: "roll" },
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
      { message: "hey", target: "Xiara", type: "whisper" },
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
    events.push({ json: '{"type":"SAY"}', text: "[say] Alice: hi" });
    events.push({ json: '{"type":"SAY"}', text: "[say] Bob: hey" });
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
        { ms: 1000, type: "read_wait" },
        handle,
        events,
        socket,
        cleanup,
      );

      expect(socket.written()).toBe("");
      events.push({ json: '{"type":"SAY"}', text: "[say] Alice: hi" });
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
      events.push({ json: '{"type":"SAY"}', text: "[say] Old: before" });
      const socket = createMockSocket();
      const cleanup = jest.fn();

      const promise = dispatchCommand(
        { ms: 1000, type: "read_wait" },
        handle,
        events,
        socket,
        cleanup,
      );

      events.push({ json: '{"type":"SAY"}', text: "[say] New: during" });
      jest.advanceTimersByTime(1000);
      await promise;
      expect(socket.written()).toBe("[say] New: during\n\n");
      expect(events.drain()).toEqual([
        { json: '{"type":"SAY"}', text: "[say] Old: before" },
        { json: '{"type":"SAY"}', text: "[say] New: during" },
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
        classId: 1,
        gender: 0,
        guild: "G",
        level: 80,
        name: "Test",
        race: 1,
        zone: 1,
      },
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { filter: "mage", type: "who" },
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
      json: '{"type":"SAY","sender":"Alice","message":"hi"}',
      text: "[say] Alice: hi",
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
        { ms: 500, type: "read_wait_json" },
        handle,
        events,
        socket,
        cleanup,
      );

      expect(socket.written()).toBe("");
      events.push({ json: '{"type":"SAY"}', text: "[say] Alice: hi" });
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
      events.push({ json: '{"old":true}', text: "[say] Old: before" });
      const socket = createMockSocket();
      const cleanup = jest.fn();

      const promise = dispatchCommand(
        { ms: 500, type: "read_wait_json" },
        handle,
        events,
        socket,
        cleanup,
      );

      events.push({ json: '{"new":true}', text: "[say] New: during" });
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
      { target: "Voidtrix", type: "invite" },
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
      { target: "Voidtrix", type: "kick" },
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
      { channel: "Trade", type: "join_channel" },
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
      { channel: "Secret", password: "hunter2", type: "join_channel" },
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
      { channel: "Trade", type: "leave_channel" },
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
      { target: "Voidtrix", type: "leader" },
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
        classId: 1,
        gender: 0,
        guild: "G",
        level: 80,
        name: "Test",
        race: 1,
        zone: 1,
      },
    ]);
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { filter: "mage", type: "who_json" },
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
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 1n,
      health: 5000,
      level: 80,
      maxHealth: 5000,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Thrall",
      npcFlags: 0,
      objectType: ObjectType.UNIT,
      position: { mapId: 1, orientation: 0, x: 1.23, y: 4.56, z: 7.89 },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };
    const testGo: GameObjectEntity = {
      bytes1: 0,
      displayId: 0,
      entry: 0,
      flags: 0,
      gameObjectType: 19,
      guid: 2n,
      name: "Mailbox",
      objectType: ObjectType.GAMEOBJECT,
      position: { mapId: 1, orientation: 0, x: 1.5, y: 4.6, z: 7.89 },
      rawFields: new Map(),
      scale: 1,
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
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 1n,
      health: 5000,
      level: 80,
      maxHealth: 5000,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Thrall",
      npcFlags: 0,
      objectType: ObjectType.UNIT,
      position: { mapId: 1, orientation: 0, x: 1.23, y: 4.56, z: 7.89 },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
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
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 10n,
      health: 3000,
      level: 55,
      maxHealth: 4000,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Arthas",
      npcFlags: 0,
      objectType: ObjectType.PLAYER,
      position: { mapId: 0, orientation: 0, x: 10.0, y: 20.0, z: 30.0 },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
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
      entry: 0,
      guid: 0xabn,
      name: undefined,
      objectType: ObjectType.CORPSE,
      position: undefined,
      rawFields: new Map(),
      scale: 1,
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
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 1n,
      health: 8000,
      level: 70,
      maxHealth: 8000,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Jaina",
      npcFlags: 0,
      objectType: ObjectType.PLAYER,
      position: undefined,
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };
    const testGo: GameObjectEntity = {
      bytes1: 0,
      displayId: 0,
      entry: 0,
      flags: 0,
      gameObjectType: 3,
      guid: 2n,
      name: "Chest",
      objectType: ObjectType.GAMEOBJECT,
      position: undefined,
      rawFields: new Map(),
      scale: 1,
    };
    const testCorpse: BaseEntity = {
      entry: 0,
      guid: 3n,
      name: undefined,
      objectType: ObjectType.CORPSE,
      position: undefined,
      rawFields: new Map(),
      scale: 1,
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
        pose: {
          mapId: 530,
          orientation: 0,
          source: "predicted",
          updatedAt: 1000,
          x: 10,
          y: 10,
          z: 10,
        },
        selfGuid: 0x1n,
      }),
    );
    const selfEntity: UnitEntity = {
      class_: 1,
      displayId: 0,
      entry: 0,
      factionTemplate: 1,
      gender: 0,
      guid: 0x1n,
      health: 100,
      level: 70,
      maxHealth: 100,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "PlayerOne",
      npcFlags: 0,
      objectType: ObjectType.PLAYER,
      position: { mapId: 530, orientation: 0, x: 1000, y: 1000, z: 10 },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 1,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };
    const near1: UnitEntity = {
      ...selfEntity,
      guid: 0x2n,
      name: "NearUnit",
      position: { mapId: 530, orientation: 0, x: 13, y: 14, z: 10 },
    };
    const near2: GameObjectEntity = {
      bytes1: 0,
      displayId: 0,
      entry: 100,
      flags: 0,
      gameObjectType: 3,
      guid: 0x3n,
      name: "NearChest",
      objectType: ObjectType.GAMEOBJECT,
      position: { mapId: 530, orientation: 0, x: 20, y: 10, z: 10 },
      rawFields: new Map(),
      scale: 1,
    };
    const distant: GameObjectEntity = {
      ...near2,
      gameObjectType: 11,
      guid: 0x4n,
      name: "DistantElevator",
      position: { mapId: 530, orientation: 0, x: 200, y: 10, z: 10 },
    };
    const offMap: UnitEntity = {
      ...selfEntity,
      guid: 0x5n,
      name: "OffMapUnit",
      position: { mapId: 0, orientation: 0, x: 10, y: 10, z: 10 },
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
    expect(rows[1]!.bearingRadians).toBeCloseTo(0.927_295_218, 8);
    expect(rows[1]!.turnRadians).toBeCloseTo(0.927_295_218, 8);
    expect(rows[1]!.originSource).toBe("predicted");
    expect(rows[1]!.originUpdatedAt).toBe(1000);
    expect(rows[2]!.guid).toBe("0x3");
    expect(rows[2]!.distance).toBe(10);
  });

  test("nearby excludes a target beyond 100 yards before rounding", async () => {
    const handle = attachControl(createMockHandle());
    handle.getControlState.mockReturnValue(sampleState());
    const target: BaseEntity = {
      entry: 0,
      guid: 0xfn,
      name: undefined,
      objectType: ObjectType.CORPSE,
      position: {
        mapId: 530,
        orientation: 0,
        x: 8809.464,
        y: -6671.76,
        z: 70.34,
      },
      rawFields: new Map(),
      scale: 1,
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
        pose: {
          mapId: 530,
          orientation: 0,
          source: "predicted",
          updatedAt: 1000,
          x: 10,
          y: 10,
          z: 10,
        },
        selfGuid: 0x1n,
      }),
    );
    const selfEntity: UnitEntity = {
      class_: 1,
      displayId: 0,
      entry: 0,
      factionTemplate: 1,
      gender: 0,
      guid: 0x1n,
      health: 100,
      level: 70,
      maxHealth: 100,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "PlayerOne",
      npcFlags: 0,
      objectType: ObjectType.PLAYER,
      position: { mapId: 530, orientation: 0, x: 10, y: 10, z: 10 },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 1,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };
    const near: UnitEntity = {
      ...selfEntity,
      guid: 0x2n,
      name: "NearUnit",
      position: { mapId: 530, orientation: 0, x: 13, y: 14, z: 10 },
    };
    const distant: GameObjectEntity = {
      bytes1: 0,
      displayId: 0,
      entry: 100,
      flags: 0,
      gameObjectType: 11,
      guid: 0x4n,
      name: "DistantElevator",
      objectType: ObjectType.GAMEOBJECT,
      position: { mapId: 530, orientation: 0, x: 210, y: 10, z: 10 },
      rawFields: new Map(),
      scale: 1,
    };
    const offMap: UnitEntity = {
      ...selfEntity,
      guid: 0x5n,
      name: "OffMapUnit",
      position: { mapId: 0, orientation: 0, x: 10, y: 10, z: 10 },
    };
    (handle.getNearbyEntities as ReturnType<typeof jest.fn>).mockReturnValue([
      distant,
      offMap,
      selfEntity,
      near,
    ]);

    const socket = createMockSocket();
    await dispatchCommand(
      { all: true, type: "nearby_json" },
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
        pose: {
          mapId: 530,
          orientation: 0,
          source: "predicted",
          updatedAt: 1000,
          x: 10,
          y: 10,
          z: 10,
        },
        selfGuid: 0x1n,
      }),
    );
    const selfEntity: UnitEntity = {
      class_: 1,
      displayId: 0,
      entry: 0,
      factionTemplate: 1,
      gender: 0,
      guid: 0x1n,
      health: 100,
      level: 70,
      maxHealth: 100,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "PlayerOne",
      npcFlags: 0,
      objectType: ObjectType.PLAYER,
      position: { mapId: 530, orientation: 0, x: 1000, y: 1000, z: 10 },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 1,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
    };
    const near: UnitEntity = {
      ...selfEntity,
      guid: 0x2n,
      name: "NearUnit",
      position: { mapId: 530, orientation: 0, x: 13, y: 14, z: 10 },
    };
    const distant: GameObjectEntity = {
      bytes1: 0,
      displayId: 0,
      entry: 100,
      flags: 0,
      gameObjectType: 11,
      guid: 0x4n,
      name: "DistantElevator",
      objectType: ObjectType.GAMEOBJECT,
      position: { mapId: 530, orientation: 0, x: 210, y: 10, z: 10 },
      rawFields: new Map(),
      scale: 1,
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
      { all: true, type: "nearby" },
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
      { target: "Arthas", type: "add_friend" },
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
      { target: "Arthas", type: "del_friend" },
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
      { target: "Spammer", type: "add_ignore" },
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
      { target: "Spammer", type: "del_ignore" },
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
      guildInfo: "",
      guildName: "Horde Elite",
      members: [
        {
          area: 10,
          gender: 0,
          guid: 1n,
          level: 80,
          name: "Thrall",
          officerNote: "",
          playerClass: 7,
          publicNote: "",
          rankIndex: 0,
          status: 1,
          timeOffline: 0,
        },
      ],
      motd: "Welcome!",
      rankNames: ["GM"],
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
      guildInfo: "",
      guildName: "Horde Elite",
      members: [
        {
          area: 10,
          gender: 0,
          guid: 1n,
          level: 80,
          name: "Thrall",
          officerNote: "",
          playerClass: 7,
          publicNote: "",
          rankIndex: 0,
          status: 1,
          timeOffline: 0,
        },
      ],
      motd: "Welcome!",
      rankNames: ["GM"],
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
      { target: "Thrall", type: "guild_invite" },
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
      { target: "Garrosh", type: "guild_kick" },
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
      { target: "Jaina", type: "guild_promote" },
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
      { target: "Arthas", type: "guild_demote" },
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
      { target: "Sylvanas", type: "guild_leader" },
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
      { message: "Raid tonight", type: "guild_motd" },
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
      { feature: "Friends list", type: "unimplemented" },
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
      { message: "hello", type: "chat" },
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
      target: "Xiara",
      type: "whisper",
    });
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { message: "follow me", type: "chat" },
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
      channel: "General",
      type: "channel",
    });
    const events = new RingBuffer<EventEntry>(10);
    const socket = createMockSocket();
    const cleanup = jest.fn();

    await dispatchCommand(
      { message: "hello general", type: "chat" },
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
      { direction: "forward", durationMs: 1000, type: "move" },
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
      { reason: "invalid direction", type: "invalid" },
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
      { direction: "forward", durationMs: 500, type: "move" },
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
        blockedReason: "obstructed",
        direction: undefined,
        moving: false,
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
      sampleState({ blockedReason: "height_unresolved", moving: false }),
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
      blockedReason: "ambiguous ground column",
      destination: { x: 8713.8, y: -6625.3, z: 70 },
      owner: "none",
      refusal: "pick_destination",
      remaining: undefined,
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
      class_: 0,
      displayId: 0,
      entry: 15_652,
      factionTemplate: 7,
      gender: 0,
      guid: 0x11n,
      health: 100,
      level: 8,
      maxHealth: 120,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Lynx",
      npcFlags: 0,
      objectType: ObjectType.UNIT,
      position: {
        mapId: 530,
        orientation: 0.5,
        x: 1,
        y: 2,
        z: 3,
      },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0x2n,
      unitFlags: 0,
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
    expect(parsed.entry).toBe(15_652);
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
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 0x10n,
      health: 187,
      level: 10,
      maxHealth: 187,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Xiara",
      npcFlags: 0,
      objectType: ObjectType.PLAYER,
      position: undefined,
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
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
    result = startDaemonServer({ handle, log, sock: sockPath, ...opts });
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
    result.events.push({ json: '{"type":"SAY"}', text: "[say] Alice: hi" });
    result.events.push({ json: '{"type":"SAY"}', text: "[say] Bob: hey" });
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

  test("HALT discards older directed commands before a newer walk", async () => {
    startTestServer();
    const actions: string[] = [];
    handle.halt.mockImplementation(() => {
      actions.push("halt");
    });
    Object.assign(handle, {
      faceGuid: () => actions.push("face"),
      walkToward: async (_target: unknown, yards: number) => {
        actions.push(`walk:${yards}`);
        return {
          pose: {
            mapId: 530,
            orientation: 0,
            source: "predicted",
            updatedAt: 0,
            x: 0,
            y: 0,
            z: 0,
          },
          status: "completed",
          traveled: yards,
        };
      },
    });
    await sendRawUntilClose(sockPath, [
      "FACE_GUID 1\nWALK_TOWARD 1 1\nHALT\nWALK_TOWARD 2 2\n",
    ]);
    expect(actions).toEqual(["halt", "walk:2"]);
  });

  test("disconnect aborts an active directed walk", async () => {
    startTestServer();
    const started = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    Object.assign(handle, {
      walkToward: (_target: unknown, _yards: number, signal?: AbortSignal) => {
        signal?.addEventListener("abort", () => aborted.resolve(), {
          once: true,
        });
        started.resolve();
        return new Promise<never>(() => {});
      },
    });
    const closed = Promise.withResolvers<void>();
    const client = await Bun.connect({
      socket: {
        close() {
          closed.resolve();
        },
        data() {},
        error(_socket, error) {
          closed.reject(error);
        },
      },
      unix: sockPath,
    });
    client.write("WALK_TOWARD 10 1\n");
    client.flush();
    await started.promise;
    client.terminate();
    await closed.promise;
    await aborted.promise;
  }, 2000);

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
      reclaimCorpse: () => {
        actions.push("reclaim");
      },
      releaseSpirit: () => {
        actions.push("release");
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
      abandonQuest: () => {
        actions.push("abandon");
      },
      acceptQuest: () => {
        actions.push("accept");
      },
      cancelInteraction: () => {
        actions.push("cancel");
      },
      chooseQuestReward: () => {
        actions.push("choose_reward");
      },
      completeQuest: () => {
        actions.push("complete");
      },
      queryQuest: () => {
        actions.push("query");
      },
      requestQuestReward: () => {
        actions.push("request_reward");
      },
      selectGossipOption: () => {
        actions.push("option");
      },
      selectQuest: () => {
        actions.push("select");
      },
      talk: () => {
        actions.push("talk");
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
      getInventoryState: () => {
        actions.push("inventory");
        return { status: "unknown" };
      },
      openLoot: (guid: bigint) => {
        actions.push(`open:${guid}`);
      },
      releaseLoot: () => {
        actions.push("release");
      },
      takeLoot: () => {
        actions.push("take");
      },
      takeLootMoney: () => {
        actions.push("money");
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
    cb({ state: sampleState(), type: "movement_started" });
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
        log,
        sock: `./tmp/test-daemon-split-${Date.now()}.sock`,
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
        log,
        sock: `./tmp/test-daemon-split-next-${Date.now()}.sock`,
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
        log,
        sock: `./tmp/test-daemon-multi-${Date.now()}.sock`,
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
      message: "hi",
      sender: "Alice",
      type: ChatType.SAY,
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
      friend: {
        area: 0,
        guid: 1n,
        level: 80,
        name: "Arthas",
        note: "",
        playerClass: 1,
        status: 0,
      },
      type: "friend-online",
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines[0]).toContain("Arthas");
  });

  test("onIgnoreEvent wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerIgnoreEvent({
      entry: { guid: 1n, name: "Spammer" },
      type: "ignore-added",
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

  test("onPacketError wiring reports the failed opcode", async () => {
    startTestServer();
    const [cb] = (handle.onPacketError as ReturnType<typeof jest.fn>).mock
      .calls[0] as [(opcode: number, err: Error) => void];
    cb(0x01_2a, new RangeError("Out of bounds access"));
    const lines = await sendToSocket("READ_JSON", sockPath);
    expect(JSON.parse(lines[0]!)).toEqual({
      data: {
        error: "Out of bounds access",
        opcode: 0x01_2a,
        type: "packet_error",
      },
      type: "PACKET",
    });
  });

  test("onEntityEvent wiring pushes to ring buffer", async () => {
    startTestServer();
    handle.triggerEntityEvent({
      entity: {
        class_: 0,
        displayId: 0,
        entry: 0,
        factionTemplate: 0,
        gender: 0,
        guid: 1n,
        health: 100,
        level: 10,
        maxHealth: 100,
        maxPower: [0, 0, 0, 0, 0, 0, 0],
        name: "Test NPC",
        npcFlags: 0,
        objectType: ObjectType.UNIT,
        position: undefined,
        power: [0, 0, 0, 0, 0, 0, 0],
        race: 0,
        rawFields: new Map(),
        scale: 1,
        target: 0n,
        unitFlags: 0,
      } satisfies UnitEntity,
      type: "appear",
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines[0]).toContain("Test NPC");
  });

  test("onEntityEvent wiring round-trip via READ_JSON", async () => {
    startTestServer();
    handle.triggerEntityEvent({
      entity: {
        class_: 0,
        displayId: 0,
        entry: 0,
        factionTemplate: 0,
        gender: 0,
        guid: 1n,
        health: 100,
        level: 10,
        maxHealth: 100,
        maxPower: [0, 0, 0, 0, 0, 0, 0],
        name: "Test NPC",
        npcFlags: 0,
        objectType: ObjectType.UNIT,
        position: undefined,
        power: [0, 0, 0, 0, 0, 0, 0],
        race: 0,
        rawFields: new Map(),
        scale: 1,
        target: 0n,
        unitFlags: 0,
      } satisfies UnitEntity,
      type: "appear",
    });
    const lines = await sendToSocket("READ_JSON", sockPath);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.type).toBe("ENTITY_APPEAR");
    expect(parsed.name).toBe("Test NPC");
  });

  test("NEARBY round-trip returns formatted entities", async () => {
    startTestServer();
    const testUnit: UnitEntity = {
      class_: 0,
      displayId: 0,
      entry: 0,
      factionTemplate: 0,
      gender: 0,
      guid: 1n,
      health: 5000,
      level: 80,
      maxHealth: 5000,
      maxPower: [0, 0, 0, 0, 0, 0, 0],
      name: "Thrall",
      npcFlags: 0,
      objectType: ObjectType.UNIT,
      position: { mapId: 1, orientation: 0, x: 1.23, y: 4.56, z: 7.89 },
      power: [0, 0, 0, 0, 0, 0, 0],
      race: 0,
      rawFields: new Map(),
      scale: 1,
      target: 0n,
      unitFlags: 0,
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
      roster: {
        guildInfo: "",
        guildName: "Horde Elite",
        members: [
          {
            area: 10,
            gender: 0,
            guid: 1n,
            level: 80,
            name: "Thrall",
            officerNote: "",
            playerClass: 7,
            publicNote: "",
            rankIndex: 0,
            status: 1,
            timeOffline: 0,
          },
        ],
        motd: "Welcome!",
        rankNames: ["GM"],
      },
      type: "guild-roster",
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines[0]).toContain("Roster updated");
  });

  test("GUILD_ROSTER round-trip with data", async () => {
    startTestServer();
    const roster = {
      guildInfo: "",
      guildName: "Horde Elite",
      members: [
        {
          area: 10,
          gender: 0,
          guid: 1n,
          level: 80,
          name: "Thrall",
          officerNote: "",
          playerClass: 7,
          publicNote: "",
          rankIndex: 0,
          status: 1,
          timeOffline: 0,
        },
      ],
      motd: "Welcome!",
      rankNames: ["GM"],
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
      challenger: "Arthas",
      type: "duel_requested",
    });
    const lines = await sendToSocket("READ", sockPath);
    expect(lines).toEqual(["[duel] Arthas challenges you to a duel"]);
  });
});

describe("recovery IPC boundary", () => {
  test("requires exact recovery action syntax", () => {
    expect(parseIpcCommand("RECOVERY_JSON")).toEqual({ type: "recovery_json" });
    expect(parseIpcCommand("QUERY_CORPSE")).toEqual({ type: "query_corpse" });
    expect(parseIpcCommand("SPIRIT_HEALER 0xa")).toEqual({
      guid: 10n,
      type: "spirit_healer",
    });
    expect(parseIpcCommand("RESURRECT accept")).toEqual({
      accept: true,
      type: "resurrect",
    });
    expect(parseIpcCommand("RESURRECT decline")).toEqual({
      accept: false,
      type: "resurrect",
    });
    for (const line of [
      "QUERY_CORPSE 1",
      "RELEASE_SPIRIT now",
      "RECLAIM_CORPSE 0",
      "SPIRIT_HEALER",
      "SPIRIT_HEALER 0",
      "SPIRIT_HEALER 0xa extra",
      "RESURRECT",
      "RESURRECT yes",
      "RESURRECT accept extra",
    ])
      expect(parseIpcCommand(line)?.type).toBe("invalid");
  });

  test("a recovery request acknowledgement does not claim a life transition", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      releaseSpirit: () => ({
        life: "dead",
        request: { action: "release", status: "unanswered" },
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

  test("spirit-healer guard refusal is ERR without success", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      activateSpiritHealer: () => {
        throw new Error("Observed creature is not a spirit healer");
      },
    });
    const socket = createMockSocket();
    await dispatchCommand(
      { guid: 10n, type: "spirit_healer" },
      handle,
      new RingBuffer<EventEntry>(10),
      socket,
      jest.fn(),
    );
    expect(socket.written()).toBe(
      "ERR Observed creature is not a spirit healer\n\n",
    );
  });

  test("recovery JSON preserves unknown timing, pose provenance and distinct corpse maps", async () => {
    const handle = Object.assign(attachControl(createMockHandle()), {
      getRecoveryState: () => ({
        corpse: {
          corpseMapId: 540,
          mapId: 530,
          observedAt: 1000,
          position: { x: 1, y: 2, z: 3 },
          status: "found",
        },
        health: 1,
        life: "ghost",
        reclaim: {
          canRequest: false,
          pose: { source: "predicted", updatedAt: 1200 },
          readiness: "blocked",
          remainingMs: undefined,
        },
        request: { action: "reclaim", status: "unanswered", timing: "unknown" },
        selfGuid: 0xffff_ffff_ffff_ffffn,
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
        guids: [1n, 2n],
        instruction: "kill fast",
        maxStarts: 3,
        type: "cycle",
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
      { guids: [1n], instruction: "fight", maxStarts: 10, type: "cycle" },
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
        currentIndex: 0,
        instruction: "fight",
        lastLoot: undefined,
        maxStarts: 10,
        phase: "fighting",
        queue: [{ guid: 1n, status: "queued" }],
        startedAt: 1000,
        startsUsed: 1,
        stopCause: undefined,
        stopDetail: undefined,
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
    onDomainEvent("cycle", { at: 1000, state, type: "started" }, events, log);
    const drained = events.drain();
    expect(drained[0]!.text).toBe("[cycle] started");
    expect(JSON.parse(drained[0]!.json).type).toBe("CYCLE");
  });
});

describe("quest IPC boundary", () => {
  test("JSON gossip code preserves omitted, null, empty and whitespace values", () => {
    expect(parseIpcCommand("SELECT_OPTION 0")).toEqual({
      code: undefined,
      optionId: 0,
      type: "select_option",
    });
    expect(parseIpcCommand("SELECT_OPTION 0 null")).toEqual({
      code: undefined,
      optionId: 0,
      type: "select_option",
    });
    expect(parseIpcCommand('SELECT_OPTION 0 ""')).toEqual({
      code: "",
      optionId: 0,
      type: "select_option",
    });
    const code = '  hello "friend"\nHALT  ';
    expect(parseIpcCommand(`SELECT_OPTION 0 ${JSON.stringify(code)}`)).toEqual({
      code,
      optionId: 0,
      type: "select_option",
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
        log: {
          complete: false,
          slots: [
            { counters: [undefined, 1, 0, 0], questId: undefined, slot: 0 },
          ],
        },
        pending: { action: "accept", questId: 42 },
        queries: [{ questId: 42, sentAt: 1000, status: "unanswered" }],
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
      guid: 0xffff_ffff_ffff_ffffn,
      type: "open_loot",
    });
    expect(parseIpcCommand("TAKE_LOOT 255")).toEqual({
      slot: 255,
      type: "take_loot",
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
      { slot: 0, type: "take_loot" },
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
        lastRelease: { guid, observedAt: 1100, status: 1 },
        loot: { guid, phase: "opening", requestedAt: 1000 },
        pending: {
          action: "open",
          guid,
          requestedAt: 1000,
          status: "unanswered",
        },
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
        bags: [],
        coinage: undefined,
        freeSlots: undefined,
        issues: [],
        scope: "carried",
        selfGuid: 1n,
        slots: [
          {
            bag: 255,
            guid,
            item: { count: undefined, guid },
            region: "backpack",
            slot: 23,
            status: "occupied",
          },
        ],
        status: "partial",
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
