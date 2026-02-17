import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { authHandshake, worldSession } from "client";
import { startMockAuthServer } from "test/mock-auth-server";
import { startMockWorldServer } from "test/mock-world-server";
import {
  FIXTURE_ACCOUNT,
  FIXTURE_PASSWORD,
  FIXTURE_CHARACTER,
  clientPrivateKey,
  clientSeed,
  sessionKey,
} from "test/fixtures";

describe("mock integration", () => {
  let authServer: { port: number; stop(): void };
  let worldServer: { port: number; stop(): void };

  const base = {
    account: FIXTURE_ACCOUNT,
    password: FIXTURE_PASSWORD,
    character: FIXTURE_CHARACTER,
    srpPrivateKey: clientPrivateKey,
    clientSeed,
  };

  beforeAll(async () => {
    worldServer = await startMockWorldServer();
    authServer = await startMockAuthServer({
      realmAddress: `127.0.0.1:${worldServer.port}`,
    });
  });

  afterAll(() => {
    authServer?.stop();
    worldServer?.stop();
  });

  test("authHandshake completes SRP and returns session key", async () => {
    const auth = await authHandshake({
      ...base,
      host: "127.0.0.1",
      port: authServer.port,
    });

    expect(auth.sessionKey).toEqual(sessionKey);
    expect(auth.realmHost).toBe("127.0.0.1");
    expect(auth.realmPort).toBe(worldServer.port);
    expect(auth.realmId).toBe(1);
  });

  test("full login flow: auth → world → character select → login", async () => {
    const auth = await authHandshake({
      ...base,
      host: "127.0.0.1",
      port: authServer.port,
    });
    const handle = await worldSession(
      { ...base, host: "127.0.0.1", port: worldServer.port },
      auth,
    );

    handle.close();
    await handle.closed;
  });
});
