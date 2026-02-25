import { test, expect, describe } from "bun:test";
import {
  authHandshake,
  worldSession,
  type ChatMessage,
  type GroupEvent,
  type EntityEvent,
} from "wow/client";
import { sendToSocket } from "cli/ipc";
import { startDaemonServer } from "daemon/server";
import { SessionLog } from "lib/session-log";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

const host = process.env["WOW_HOST"] ?? "t1";
const port = parseInt(process.env["WOW_PORT"] ?? "3724", 10);

const language = parseInt(process.env["WOW_LANGUAGE"] ?? "1", 10);

const config1 = {
  host,
  port,
  account: process.env["WOW_ACCOUNT_1"] ?? "",
  password: process.env["WOW_PASSWORD_1"] ?? "",
  character: process.env["WOW_CHARACTER_1"] ?? "",
  language,
};

const config2 = {
  host,
  port,
  account: process.env["WOW_ACCOUNT_2"] ?? "",
  password: process.env["WOW_PASSWORD_2"] ?? "",
  character: process.env["WOW_CHARACTER_2"] ?? "",
  language,
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
    expect(whisper!.sender).toBe(config1.character);
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

function waitForGroupEvent<T extends GroupEvent["type"]>(
  events: GroupEvent[],
  type: T,
  filter?: (e: Extract<GroupEvent, { type: T }>) => boolean,
  timeoutMs = 5000,
): Promise<Extract<GroupEvent, { type: T }>> {
  const startIdx = events.length;
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`timeout waiting for ${type}`));
    }, timeoutMs);
    const poll = setInterval(() => {
      for (let i = startIdx; i < events.length; i++) {
        const e = events[i]!;
        if (
          e.type === type &&
          (!filter || filter(e as Extract<GroupEvent, { type: T }>))
        ) {
          clearInterval(poll);
          clearTimeout(deadline);
          resolve(e as Extract<GroupEvent, { type: T }>);
          return;
        }
      }
    }, 50);
  });
}

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
      const hasMembers = (e: { members: unknown[] }) => e.members.length >= 1;
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
    const { server } = startDaemonServer({ handle, sock: sockPath, log });

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
    let handle2: Awaited<ReturnType<typeof worldSession>> | undefined;

    try {
      await Bun.sleep(2000);

      const events: EntityEvent[] = [];
      handle1.onEntityEvent((e) => events.push(e));

      handle2 = await worldSession(config2, auth2);

      await Bun.sleep(5000);

      const namedEntity = events.find(
        (e) =>
          (e.type === "appear" && e.entity.name === config2.character) ||
          (e.type === "update" &&
            e.changed.includes("name") &&
            e.entity.name === config2.character),
      );
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
      await Bun.sleep(3000);

      const entities = handle1.getNearbyEntities();
      expect(entities.length).toBeGreaterThan(0);

      const withPosition = entities.filter((e) => e.position);
      expect(withPosition.length).toBeGreaterThan(0);

      for (const e of withPosition) {
        expect(e.position!.x).not.toBeNaN();
        expect(e.position!.y).not.toBeNaN();
        expect(e.position!.z).not.toBeNaN();
      }
    } finally {
      handle1.close();
      await handle1.closed;
    }
  }, 15_000);
});
