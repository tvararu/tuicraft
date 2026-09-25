import { describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { sendToSocket } from "cli/ipc";
import { startDaemonServer } from "daemon/server";
import { SessionLog } from "lib/session-log";
import {
  daemonSock,
  dist2d,
  type GpsFix,
  parseGps,
  waitForEntityEvent,
  waitForGroupEvent,
  waitUntil,
} from "test/live-helpers";
import { must } from "test/must";
import { authHandshake } from "wow/auth";
import {
  type ChatMessage,
  type EntityEvent,
  type GroupEvent,
  type WorldHandle,
  worldSession,
} from "wow/client";
import type { ControlEvent } from "wow/control";
import type { RecoveryEvent } from "wow/recovery";

const host = process.env["WOW_HOST"] ?? "t1";
const port = Number.parseInt(process.env["WOW_PORT"] ?? "3724", 10);

const language = Number.parseInt(process.env["WOW_LANGUAGE"] ?? "1", 10);

const config1 = {
  account: process.env["WOW_ACCOUNT_1"] ?? "",
  character: process.env["WOW_CHARACTER_1"] ?? "",
  host,
  language,
  password: process.env["WOW_PASSWORD_1"] ?? "",
  port,
};

const config2 = {
  account: process.env["WOW_ACCOUNT_2"] ?? "",
  character: process.env["WOW_CHARACTER_2"] ?? "",
  host,
  language,
  password: process.env["WOW_PASSWORD_2"] ?? "",
  port,
};

test("full login flow against live server", async () => {
  const auth = await authHandshake(config1);
  expect(auth.sessionKey.byteLength).toBe(40);

  const handle = await worldSession(config1, auth);
  await Bun.sleep(2000);
  handle.close();
  await handle.closed;
});

describe("two-client chat", () => {
  test("whisper between two characters", async () => {
    const auth1 = await authHandshake(config1);
    const auth2 = await authHandshake(config2);

    const handle1 = await worldSession(config1, auth1);
    const handle2 = await worldSession(config2, auth2);

    await Bun.sleep(1000);

    const received: ChatMessage[] = [];
    handle2.onMessage((msg) => received.push(msg));

    handle1.sendWhisper(config2.character, "hello from client 1");

    await Bun.sleep(3000);

    handle1.close();
    handle2.close();
    await Promise.all([handle1.closed, handle2.closed]);

    const whisper = received.find((m) => m.message === "hello from client 1");
    expect(whisper).toBeDefined();
    expect(must(whisper).sender).toBe(config1.character);
  }, 30_000);

  test("who query returns results", async () => {
    const auth1 = await authHandshake(config1);
    const handle1 = await worldSession(config1, auth1);

    await Bun.sleep(1000);

    const results = await handle1.who({});
    expect(results.length).toBeGreaterThan(0);

    handle1.close();
    await handle1.closed;
  }, 30_000);

  test("whisper to nonexistent player triggers not-found", async () => {
    const auth1 = await authHandshake(config1);
    const handle1 = await worldSession(config1, auth1);

    await Bun.sleep(1000);

    const received: ChatMessage[] = [];
    handle1.onMessage((msg) => received.push(msg));

    handle1.sendWhisper("Nonexistentcharactername", "hello?");

    await Bun.sleep(3000);

    handle1.close();
    await handle1.closed;

    const notFound = received.find((m) =>
      m.message.includes("Nonexistentcharactername"),
    );
    expect(notFound).toBeDefined();
  }, 30_000);

  test("say message received by nearby client", async () => {
    const auth1 = await authHandshake(config1);
    const auth2 = await authHandshake(config2);

    const handle1 = await worldSession(config1, auth1);
    const handle2 = await worldSession(config2, auth2);

    await Bun.sleep(1000);
    handle1.sendWhisper(config1.character, `.appear ${config2.character}`);
    await Bun.sleep(2500);

    const received: ChatMessage[] = [];
    handle2.onMessage((msg) => received.push(msg));

    handle1.sendSay("hello from say test");

    await Bun.sleep(3000);

    handle1.close();
    handle2.close();
    await Promise.all([handle1.closed, handle2.closed]);

    const sayMsg = received.find((m) => m.message === "hello from say test");
    expect(sayMsg).toBeDefined();
  }, 30_000);
});

describe("fault paths", () => {
  test("forced teleport relocates and recovers", async () => {
    const auth1 = await authHandshake(config1);
    const handle1 = await worldSession(config1, auth1);
    const daemon = await daemonSock(handle1, "teleport");
    const chat: ChatMessage[] = [];
    const control: ControlEvent[] = [];
    handle1.onMessage((m) => chat.push(m));
    handle1.onControlEvent((e) => control.push(e));

    let before: GpsFix | undefined;
    try {
      await Bun.sleep(2000);
      const hpA = handle1.getCombatState().self.health;
      await Bun.sleep(5000);
      const stateA = handle1.getCombatState();
      expect(stateA.attacking).toBe(false);
      expect(stateA.self.health).toBe(hpA);

      chat.length = 0;
      handle1.sendWhisper(config1.character, ".gps");
      await Bun.sleep(2500);
      before = parseGps(chat);
      expect(before).toBeDefined();

      handle1.sendWhisper(config1.character, ".tele FairbreezeVillage");
      await Bun.sleep(8000);

      chat.length = 0;
      handle1.sendWhisper(config1.character, ".gps");
      await Bun.sleep(2500);
      const after = parseGps(chat);
      expect(after).toBeDefined();
      expect(dist2d(must(before), must(after))).toBeGreaterThan(100);

      expect(control.some((e) => e.type === "control_error")).toBe(false);

      const status = await sendToSocket("STATUS", daemon.sock);
      expect(status).toEqual(["CONNECTED"]);
      const move = await sendToSocket("MOVE forward 500", daemon.sock);
      expect(move).toEqual(["OK"]);
    } finally {
      if (before) {
        handle1.sendWhisper(
          config1.character,
          `.go xyz ${before.x} ${before.y} ${before.z} ${before.map}`,
        );
        await Bun.sleep(2500);
      }
      await daemon.close();
      handle1.close();
      await handle1.closed;
    }
  }, 90_000);

  test("freeze denies movement then releases", async () => {
    const auth1 = await authHandshake(config1);
    const handle1 = await worldSession(config1, auth1);
    const daemon = await daemonSock(handle1, "freeze");
    const chat: ChatMessage[] = [];
    const control: ControlEvent[] = [];
    handle1.onMessage((m) => chat.push(m));
    handle1.onControlEvent((e) => control.push(e));

    try {
      await Bun.sleep(2000);
      const vitals = handle1.getCombatState().self;
      expect(vitals.health).toBe(vitals.maxHealth);

      chat.length = 0;
      handle1.sendWhisper(config1.character, ".freeze");
      await Bun.sleep(2500);
      expect(chat.some((m) => /froze player/.test(m.message))).toBe(true);

      chat.length = 0;
      handle1.sendWhisper(config1.character, ".gps");
      await Bun.sleep(2500);
      const held = parseGps(chat);
      expect(held).toBeDefined();
      const moveHeld = await sendToSocket("MOVE forward 500", daemon.sock);
      expect(moveHeld[0]).not.toMatch(/^ERR internal/);
      await Bun.sleep(1000);
      chat.length = 0;
      handle1.sendWhisper(config1.character, ".gps");
      await Bun.sleep(2500);
      const heldAfter = parseGps(chat);
      expect(heldAfter).toBeDefined();
      expect(dist2d(must(held), must(heldAfter))).toBeLessThan(1.5);

      handle1.sendWhisper(config1.character, ".unfreeze");
      await Bun.sleep(2500);
      const moveFree = await sendToSocket("MOVE forward 500", daemon.sock);
      expect(moveFree).toEqual(["OK"]);

      expect(control.some((e) => e.type === "control_error")).toBe(false);
      const status = await sendToSocket("STATUS", daemon.sock);
      expect(status).toEqual(["CONNECTED"]);
    } finally {
      await daemon.close();
      handle1.close();
      await handle1.closed;
    }
  }, 90_000);

  test("held WHO meets HALT without error", async () => {
    const auth1 = await authHandshake(config1);
    const handle1 = await worldSession(config1, auth1);
    const daemon = await daemonSock(handle1, "heldquery");

    try {
      await Bun.sleep(1000);
      const lines = await new Promise<string[]>((resolve, reject) => {
        const splitLines = (text: string): string[] =>
          text
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
        let buffer = "";
        let done = false;
        const finish = (socket: { end: () => void }) => {
          if (done) return;
          done = true;
          socket.end();
          resolve(splitLines(buffer));
        };
        Bun.connect({
          socket: {
            close() {
              if (!done) {
                done = true;
                resolve(splitLines(buffer));
              }
            },
            data(socket, data) {
              buffer += Buffer.from(data).toString();
              if (splitLines(buffer).length >= 2) finish(socket);
            },
            error(_socket, err) {
              reject(err);
            },
            open(socket) {
              socket.write("WHO_JSON\nHALT\n");
              socket.flush();
            },
          },
          unix: daemon.sock,
        });
      });
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines).toContain("OK");
      const whoLine = lines.find((l) => l !== "OK");
      expect(whoLine).toBeDefined();
      expect(() => JSON.parse(must(whoLine))).not.toThrow();

      const status = await sendToSocket("STATUS", daemon.sock);
      expect(status).toEqual(["CONNECTED"]);
      const say = await sendToSocket("SAY hello after held query", daemon.sock);
      expect(say).toEqual(["OK"]);
    } finally {
      await daemon.close();
      handle1.close();
      await handle1.closed;
    }
  }, 60_000);
});

describe("party management", () => {
  test("invite, accept, leader transfer, leave", async () => {
    const auth1 = await authHandshake(config1);
    const auth2 = await authHandshake(config2);

    const handle1 = await worldSession(config1, auth1);
    const handle2 = await worldSession(config2, auth2);

    try {
      await Bun.sleep(1000);

      handle1.leaveGroup();
      handle2.leaveGroup();
      await Bun.sleep(2000);

      const events1: GroupEvent[] = [];
      const events2: GroupEvent[] = [];
      handle1.onGroupEvent((e) => events1.push(e));
      handle2.onGroupEvent((e) => events2.push(e));

      handle1.invite(config2.character);
      await waitForGroupEvent(events2, "invite_received");

      handle2.acceptInvite();
      const hasMembers = (e: { members: unknown[] }) => e.members.length > 0;
      const [list1, list2] = await Promise.all([
        waitForGroupEvent(events1, "group_list", hasMembers),
        waitForGroupEvent(events2, "group_list", hasMembers),
      ]);

      expect(list1.leader).toBe(config1.character);
      expect(list2.leader).toBe(config1.character);

      handle1.setLeader(config2.character);
      const leaderChanged = await waitForGroupEvent(events1, "leader_changed");
      expect(leaderChanged.name).toBe(config2.character);

      handle2.leaveGroup();
      await waitForGroupEvent(events1, "group_destroyed");
    } finally {
      handle1.close();
      handle2.close();
      await Promise.all([handle1.closed, handle2.closed]);
    }
  }, 30_000);
});

describe("daemon IPC", () => {
  test("STATUS, SAY, READ_WAIT via inline daemon server", async () => {
    const auth = await authHandshake(config1);
    const handle = await worldSession(config1, auth);

    const sockPath = join("./tmp", `test-daemon-${Date.now()}.sock`);
    const logFile = join("./tmp", `test-session-${Date.now()}.log`);
    const log = new SessionLog(logFile);
    const { server } = startDaemonServer({ handle, log, sock: sockPath });

    try {
      await Bun.sleep(1000);

      const status = await sendToSocket("STATUS", sockPath);
      expect(status).toEqual(["CONNECTED"]);

      const say = await sendToSocket("SAY hello from ipc test", sockPath);
      expect(say).toEqual(["OK"]);

      await Bun.sleep(1000);

      const read = await sendToSocket("READ_WAIT 2000", sockPath);
      expect(read.length).toBeGreaterThanOrEqual(0);
    } finally {
      server.stop(true);
      handle.close();
      await handle.closed;
      await unlink(sockPath).catch(() => {});
      await unlink(logFile).catch(() => {});
    }
  }, 60_000);
});

describe("entity tracking", () => {
  test("character sees another character appear", async () => {
    const auth1 = await authHandshake(config1);
    const auth2 = await authHandshake(config2);

    const handle1 = await worldSession(config1, auth1);
    let handle2: WorldHandle | undefined;

    try {
      await Bun.sleep(2000);
      handle1.sendWhisper(config1.character, `.appear ${config2.character}`);
      await Bun.sleep(2500);

      const events: EntityEvent[] = [];
      handle1.onEntityEvent((e) => events.push(e));

      handle2 = await worldSession(config2, auth2);

      const isChar2 = (
        e: Extract<EntityEvent, { type: "appear" | "update" }>,
      ) => e.entity.name === config2.character;

      const namedEntity = await Promise.race([
        waitForEntityEvent(events, "appear", isChar2),
        waitForEntityEvent(
          events,
          "update",
          (e) =>
            e.changed.includes("name") && e.entity.name === config2.character,
        ),
      ]);
      expect(namedEntity).toBeDefined();

      const inStore = handle1
        .getNearbyEntities()
        .filter((e) => e.name === config2.character);
      expect(inStore.length).toBe(1);
    } finally {
      handle2?.close();
      handle1.close();
      await Promise.all([handle2?.closed, handle1.closed]);
    }
  }, 30_000);

  test("getNearbyEntities returns entities with positions", async () => {
    const auth1 = await authHandshake(config1);
    const handle1 = await worldSession(config1, auth1);

    try {
      const events: EntityEvent[] = [];
      handle1.onEntityEvent((e) => events.push(e));

      await waitForEntityEvent(
        events,
        "appear",
        (e) => e.entity.position !== undefined,
      );

      const entities = handle1.getNearbyEntities();
      expect(entities.length).toBeGreaterThan(0);

      const withPosition = entities.filter((e) => e.position);
      expect(withPosition.length).toBeGreaterThan(0);

      for (const e of withPosition) {
        expect(must(e.position).x).not.toBeNaN();
        expect(must(e.position).y).not.toBeNaN();
        expect(must(e.position).z).not.toBeNaN();
      }
    } finally {
      handle1.close();
      await handle1.closed;
    }
  }, 15_000);
});

describe("gameplay guards while alive", () => {
  test("initial spells populate the learned list", async () => {
    const auth1 = await authHandshake(config1);
    const handle1 = await worldSession(config1, auth1);

    try {
      await waitUntil(() => handle1.getCombatState().learned.length > 0);
      expect(handle1.getCombatState().learned.length).toBeGreaterThan(0);
    } finally {
      handle1.close();
      await handle1.closed;
    }
  }, 20_000);

  test("recovery and loot refuse while alive", async () => {
    const auth1 = await authHandshake(config1);
    const handle1 = await worldSession(config1, auth1);
    const events: RecoveryEvent[] = [];
    handle1.onRecoveryEvent((e) => events.push(e));

    try {
      await waitUntil(() => handle1.getRecoveryState().life === "alive");
      const state = handle1.getRecoveryState();
      expect(state.health).toBeGreaterThan(0);
      expect((state.flags ?? 0) & 0x10).toBe(0);

      expect(() => handle1.releaseSpirit()).toThrow(
        "Release requires authoritative dead state",
      );
      expect(() => handle1.reclaimCorpse()).toThrow(
        "Cannot request reclaim: not_ghost",
      );
      expect(() => handle1.openLoot(0xf130000000000001n)).toThrow(
        "Loot source is not an observed creature",
      );

      handle1.queryCorpse();
      await waitUntil(() => events.some((e) => e.type === "corpse_observed"));
      expect(handle1.getRecoveryState().corpse.status).toBe("absent");
      expect(handle1.getRecoveryState().life).toBe("alive");
    } finally {
      handle1.onRecoveryEvent(undefined);
      handle1.close();
      await handle1.closed;
    }
  }, 20_000);
});
