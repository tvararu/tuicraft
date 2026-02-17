import { test, expect } from "bun:test";
import { authHandshake, worldSession } from "client";

const config = {
  host: process.env["WOW_HOST"] ?? "t1",
  port: parseInt(process.env["WOW_PORT"] ?? "3724", 10),
  account: process.env["WOW_ACCOUNT"] ?? "",
  password: process.env["WOW_PASSWORD"] ?? "",
  character: process.env["WOW_CHARACTER"] ?? "",
};

test("full login flow against live server", async () => {
  const auth = await authHandshake(config);
  expect(auth.sessionKey.byteLength).toBe(40);

  const handle = await worldSession(config, auth);
  await Bun.sleep(2000);
  handle.close();
  await handle.closed;
});
