import type { Socket } from "bun";
import { PacketReader } from "wow/protocol/packet";
import { SRP, type SRPResult } from "wow/crypto/srp";
import { AuthOpcode } from "wow/protocol/opcodes";
import {
  buildLogonChallenge,
  parseLogonChallengeResponse,
  buildLogonProof,
  parseLogonProofResponse,
  buildRealmListRequest,
  parseRealmList,
  parseReconnectChallengeResponse,
  buildReconnectProof,
} from "wow/protocol/auth";
import { AccumulatorBuffer } from "wow/protocol/world";
import type { ClientConfig } from "wow/client";

export type AuthResult = {
  sessionKey: Uint8Array;
  realmHost: string;
  realmPort: number;
  realmId: number;
};

export class ReconnectRequiredError extends Error {
  constructor() {
    super("Server requires reconnect but no cached session key is available");
    this.name = "ReconnectRequiredError";
  }
}

type AuthContext = {
  buf: AccumulatorBuffer;
  srp: SRP;
  phase: "challenge" | "proof" | "reconnect_proof" | "realms";
  config: ClientConfig;
  srpResult?: SRPResult;
  sessionKey?: Uint8Array;
};

function handleChallenge(
  raw: Uint8Array,
  config: ClientConfig,
  srp: SRP,
): SRPResult {
  const r = new PacketReader(raw);
  r.skip(1);
  const result = parseLogonChallengeResponse(r);
  if (result.status !== 0x00) {
    throw new Error(
      `Auth challenge failed: status 0x${result.status.toString(16)}`,
    );
  }
  return srp.calculate(
    result.g!,
    result.N!,
    result.salt!,
    result.B!,
    config.srpPrivateKey,
  );
}

function handleProof(raw: Uint8Array, srpResult: SRPResult): void {
  const r = new PacketReader(raw);
  r.skip(1);
  const result = parseLogonProofResponse(r);
  if (result.status !== 0x00) {
    throw new Error(
      `Auth proof failed: status 0x${result.status.toString(16)}`,
    );
  }
  if (result.M2 !== srpResult.M2) throw new Error("Server M2 mismatch");
}

function handleRealms(
  raw: Uint8Array,
): Pick<AuthResult, "realmHost" | "realmPort" | "realmId"> {
  const realms = parseRealmList(new PacketReader(raw, 1));
  if (realms.length === 0) throw new Error("No realms available");
  const realm = realms[0]!;
  return { realmHost: realm.host, realmPort: realm.port, realmId: realm.id };
}

function handleReconnectChallenge(
  raw: Uint8Array,
  config: ClientConfig,
): Uint8Array {
  if (!config.cachedSessionKey) throw new ReconnectRequiredError();
  const r = new PacketReader(raw);
  const result = parseReconnectChallengeResponse(r);
  if (result.status !== 0x00) {
    throw new Error(
      `Reconnect challenge failed: status 0x${result.status.toString(16)}`,
    );
  }
  return buildReconnectProof(
    config.account,
    result.challengeData!,
    config.cachedSessionKey,
  );
}

function handleReconnectProof(raw: Uint8Array): void {
  const r = new PacketReader(raw);
  r.skip(1);
  const status = r.uint8();
  if (status !== 0x00) {
    throw new Error(`Reconnect proof failed: status 0x${status.toString(16)}`);
  }
}

function advanceAuth(ctx: AuthContext, socket: Socket): AuthResult | undefined {
  const raw = ctx.buf.peek(ctx.buf.length);
  let result: AuthResult | undefined;

  if (ctx.phase === "challenge") {
    if (raw[0] === AuthOpcode.RECONNECT_CHALLENGE) {
      socket.write(handleReconnectChallenge(raw, ctx.config));
      ctx.sessionKey = ctx.config.cachedSessionKey!;
      ctx.phase = "reconnect_proof";
    } else {
      ctx.srpResult = handleChallenge(raw, ctx.config, ctx.srp);
      ctx.sessionKey = ctx.srpResult.K;
      socket.write(buildLogonProof(ctx.srpResult));
      ctx.phase = "proof";
    }
  } else if (ctx.phase === "proof") {
    handleProof(raw, ctx.srpResult!);
    socket.write(buildRealmListRequest());
    ctx.phase = "realms";
  } else if (ctx.phase === "reconnect_proof") {
    handleReconnectProof(raw);
    socket.write(buildRealmListRequest());
    ctx.phase = "realms";
  } else {
    result = { sessionKey: ctx.sessionKey!, ...handleRealms(raw) };
  }

  ctx.buf.drain(ctx.buf.length);
  return result;
}

export function authHandshake(config: ClientConfig): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const ctx: AuthContext = {
      buf: new AccumulatorBuffer(),
      srp: new SRP(config.account, config.password),
      phase: "challenge",
      config,
    };
    let done = false;

    Bun.connect({
      hostname: config.host,
      port: config.port,
      socket: {
        open(socket) {
          socket.write(buildLogonChallenge(config.account));
        },
        data(socket, data) {
          ctx.buf.append(new Uint8Array(data));
          try {
            const result = advanceAuth(ctx, socket);
            if (result) {
              done = true;
              socket.end();
              resolve(result);
            }
          } catch (err) {
            if (err instanceof RangeError) return;
            done = true;
            reject(err);
            socket.end();
          }
        },
        close() {
          if (!done) reject(new Error("Auth connection closed"));
        },
      },
    }).catch(reject);
  });
}

export async function authWithRetry(
  config: ClientConfig,
  opts?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<AuthResult> {
  const maxAttempts = opts?.maxAttempts ?? 5;
  const baseDelay = opts?.baseDelayMs ?? 5000;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await authHandshake(config);
    } catch (err) {
      if (!(err instanceof ReconnectRequiredError)) throw err;
      lastError = err;
      if (attempt + 1 < maxAttempts) {
        const delay = Math.min(baseDelay * 2 ** attempt, 60000);
        await Bun.sleep(delay);
      }
    }
  }
  throw lastError;
}
