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

describe("canned integration", () => {
  let authServer: { port: number; stop(): void };
  let worldServer: { port: number; stop(): void };

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
      host: "127.0.0.1",
      port: authServer.port,
      account: FIXTURE_ACCOUNT,
      password: FIXTURE_PASSWORD,
      character: FIXTURE_CHARACTER,
      srpPrivateKey: clientPrivateKey,
    });

    expect(auth.sessionKey).toEqual(sessionKey);
    expect(auth.realmHost).toBe("127.0.0.1");
    expect(auth.realmPort).toBe(worldServer.port);
    expect(auth.realmId).toBe(1);
  });

  test("full login flow: auth → world → character select → login", async () => {
    const auth = await authHandshake({
      host: "127.0.0.1",
      port: authServer.port,
      account: FIXTURE_ACCOUNT,
      password: FIXTURE_PASSWORD,
      character: FIXTURE_CHARACTER,
      srpPrivateKey: clientPrivateKey,
      clientSeed,
    });

    const handle = await worldSession(
      {
        host: "127.0.0.1",
        port: worldServer.port,
        account: FIXTURE_ACCOUNT,
        password: FIXTURE_PASSWORD,
        character: FIXTURE_CHARACTER,
        clientSeed,
      },
      auth,
    );

    handle.close();
    await handle.closed;
  });
});
