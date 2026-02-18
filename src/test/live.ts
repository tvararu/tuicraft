import { test, expect } from "bun:test";
import { authHandshake, worldSession } from "client";

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
