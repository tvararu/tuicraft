import { describe, expect, type jest, test } from "bun:test";
import { ChatType, ObjectType, type UnitEntity } from "@tuicraft/core";
import { must } from "@tuicraft/core/test-support/must";
import { sendToSocket } from "#cli/ipc";
import { useIpcServer } from "#test-support/commands-fixtures";

describe("IPC round-trip", () => {
  const ipc = useIpcServer();

  test("onMessage wiring pushes to ring buffer", async () => {
    ipc.start();
    ipc.handle.triggerMessage({
      message: "hi",
      sender: "Alice",
      type: ChatType.SAY,
    });
    const lines = await sendToSocket("READ", ipc.sockPath);
    expect(lines).toEqual(["[say] Alice: hi"]);
  });

  test("send wait since a mark returns the send's result, not stale unread", async () => {
    let requests = 0;
    ipc.start({
      onActivity: () => {
        if (++requests !== 3) return;
        queueMicrotask(() =>
          ipc.handle.triggerMessage({
            message: "rolled 30 (1-100)",
            sender: "",
            type: ChatType.SYSTEM,
          }),
        );
      },
    });
    ipc.handle.triggerMessage({
      message: "stale",
      sender: "Alice",
      type: ChatType.SAY,
    });
    const [mark = ""] = await sendToSocket("EVENT_MARK", ipc.sockPath);
    expect(await sendToSocket("ROLL 100", ipc.sockPath)).toEqual(["OK"]);
    expect(await sendToSocket(`READ_WAIT 5000 ${mark}`, ipc.sockPath)).toEqual([
      "[system] rolled 30 (1-100)",
    ]);
    expect(await sendToSocket("READ", ipc.sockPath)).toEqual([
      "[say] Alice: stale",
    ]);
  });

  test("onGroupEvent wiring pushes to ring buffer", async () => {
    ipc.start();
    ipc.handle.triggerGroupEvent({ type: "group_destroyed" });
    const lines = await sendToSocket("READ", ipc.sockPath);
    expect(lines).toEqual(["[group] Group has been disbanded"]);
  });

  test("onFriendEvent wiring pushes to ring buffer", async () => {
    ipc.start();
    ipc.handle.triggerFriendEvent({
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
    const lines = await sendToSocket("READ", ipc.sockPath);
    expect(lines[0]).toContain("Arthas");
  });

  test("onIgnoreEvent wiring pushes to ring buffer", async () => {
    ipc.start();
    ipc.handle.triggerIgnoreEvent({
      entry: { guid: 1n, name: "Spammer" },
      type: "ignore-added",
    });
    const lines = await sendToSocket("READ", ipc.sockPath);
    expect(lines[0]).toContain("Spammer");
    expect(lines[0]).toContain("added to ignore list");
  });

  test("IGNORED round-trip returns empty list", async () => {
    ipc.start();
    const lines = await sendToSocket("IGNORED", ipc.sockPath);
    expect(lines).toEqual(["[ignore] Ignore list is empty"]);
  });

  test("onPacketError wiring reports the failed opcode", async () => {
    ipc.start();
    const [cb] = (ipc.handle.onPacketError as ReturnType<typeof jest.fn>).mock
      .calls[0] as [(opcode: number, err: Error) => void];
    cb(0x01_2a, new RangeError("Out of bounds access"));
    const lines = await sendToSocket("READ_JSON", ipc.sockPath);
    expect(JSON.parse(must(lines[0]))).toEqual({
      data: {
        error: "Out of bounds access",
        opcode: 0x01_2a,
        type: "packet_error",
      },
      type: "PACKET",
    });
  });

  test("onEntityEvent wiring pushes to ring buffer", async () => {
    ipc.start();
    ipc.handle.triggerEntityEvent({
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
    const lines = await sendToSocket("READ", ipc.sockPath);
    expect(lines[0]).toContain("Test NPC");
  });

  test("onEntityEvent wiring round-trip via READ_JSON", async () => {
    ipc.start();
    ipc.handle.triggerEntityEvent({
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
    const lines = await sendToSocket("READ_JSON", ipc.sockPath);
    const parsed = JSON.parse(must(lines[0]));
    expect(parsed.type).toBe("ENTITY_APPEAR");
    expect(parsed.name).toBe("Test NPC");
  });

  test("NEARBY round-trip returns formatted entities", async () => {
    ipc.start();
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
    (
      ipc.handle.getNearbyEntities as ReturnType<typeof jest.fn>
    ).mockReturnValue([testUnit]);
    const lines = await sendToSocket("NEARBY", ipc.sockPath);
    expect(lines[0]).toContain("Thrall");
    expect(lines[0]).toContain("level 80");
  });

  test("onGuildEvent wiring pushes to ring buffer", async () => {
    ipc.start();
    ipc.handle.triggerGuildEvent({
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
    const lines = await sendToSocket("READ", ipc.sockPath);
    expect(lines[0]).toContain("Roster updated");
  });

  test("GUILD_ROSTER round-trip with data", async () => {
    ipc.start();
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
    (
      ipc.handle.requestGuildRoster as ReturnType<typeof jest.fn>
    ).mockResolvedValue(roster);
    const lines = await sendToSocket("GUILD_ROSTER", ipc.sockPath);
    expect(lines[0]).toContain("Horde Elite");
    expect(lines.join("\n")).toContain("Thrall");
  });

  test("dispatch error returns ERR internal", async () => {
    ipc.start();
    (ipc.handle.who as ReturnType<typeof jest.fn>).mockRejectedValue(
      new Error("db fail"),
    );
    const lines = await sendToSocket("WHO", ipc.sockPath);
    expect(lines).toEqual(["ERR internal"]);
  });

  test("onDuelEvent wiring pushes to ring buffer", async () => {
    ipc.start();
    ipc.handle.triggerDuelEvent({
      challenger: "Arthas",
      type: "duel_requested",
    });
    const lines = await sendToSocket("READ", ipc.sockPath);
    expect(lines).toEqual(["[duel] Arthas challenges you to a duel"]);
  });
});
