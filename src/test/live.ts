import { test, expect, describe } from "bun:test";
import { authHandshake, worldSession, type ChatMessage } from "client";

const host = process.env["WOW_HOST"] ?? "t1";
const port = parseInt(process.env["WOW_PORT"] ?? "3724", 10);

const config1 = {
  host,
  port,
  account: process.env["WOW_ACCOUNT_1"] ?? "",
  password: process.env["WOW_PASSWORD_1"] ?? "",
  character: process.env["WOW_CHARACTER_1"] ?? "",
};

const config2 = {
  host,
  port,
  account: process.env["WOW_ACCOUNT_2"] ?? "",
  password: process.env["WOW_PASSWORD_2"] ?? "",
  character: process.env["WOW_CHARACTER_2"] ?? "",
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
