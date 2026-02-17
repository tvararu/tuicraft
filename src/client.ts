import { PacketReader, PacketWriter } from "protocol/packet";
import { SRP } from "crypto/srp";
import { Arc4 } from "crypto/arc4";
import { GameOpcode } from "protocol/opcodes";
import {
  buildLogonChallenge,
  parseLogonChallengeResponse,
  buildLogonProof,
  parseLogonProofResponse,
  buildRealmListRequest,
  parseRealmList,
} from "protocol/auth";
import {
  buildWorldAuthPacket,
  parseCharacterList,
  OpcodeDispatch,
  AccumulatorBuffer,
  INCOMING_HEADER_SIZE,
  buildOutgoingPacket,
  decryptIncomingHeader,
} from "protocol/world";

export interface ClientConfig {
  host: string;
  port: number;
  account: string;
  password: string;
  character: string;
  srpPrivateKey?: bigint;
  clientSeed?: Uint8Array;
  pingIntervalMs?: number;
}

export interface AuthResult {
  sessionKey: Uint8Array;
  realmHost: string;
  realmPort: number;
  realmId: number;
}

export interface WorldHandle {
  closed: Promise<void>;
  close(): void;
}

export function authHandshake(config: ClientConfig): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const buf = new AccumulatorBuffer();
    const srp = new SRP(config.account, config.password);
    let state: "challenge" | "proof" | "realms" = "challenge";
    let srpResult: ReturnType<SRP["calculate"]>;
    let done = false;

    Bun.connect({
      hostname: config.host,
      port: config.port,
      socket: {
        open(socket) {
          socket.write(buildLogonChallenge(config.account));
        },
        data(socket, data) {
          buf.append(new Uint8Array(data));

          if (state === "challenge") {
            const raw = buf.drain(buf.length);
            const r = new PacketReader(raw);
            r.skip(1);
            const result = parseLogonChallengeResponse(r);
            if (result.status !== 0x00) {
              done = true;
              reject(
                new Error(
                  `Auth challenge failed: status 0x${result.status.toString(16)}`,
                ),
              );
              socket.end();
              return;
            }
            srpResult = srp.calculate(
              result.g!,
              result.N!,
              result.salt!,
              result.B!,
              config.srpPrivateKey,
            );
            socket.write(buildLogonProof(srpResult));
            state = "proof";
          } else if (state === "proof") {
            const raw = buf.drain(buf.length);
            const r = new PacketReader(raw);
            r.skip(1);
            const result = parseLogonProofResponse(r);
            if (result.status !== 0x00) {
              done = true;
              reject(
                new Error(
                  `Auth proof failed: status 0x${result.status.toString(16)}`,
                ),
              );
              socket.end();
              return;
            }
            if (result.M2 !== srpResult.M2) {
              done = true;
              reject(new Error("Server M2 mismatch"));
              socket.end();
              return;
            }
            socket.write(buildRealmListRequest());
            state = "realms";
          } else if (state === "realms") {
            const raw = buf.drain(buf.length);
            const r = new PacketReader(raw, 1);
            const realms = parseRealmList(r);
            if (realms.length === 0) {
              done = true;
              reject(new Error("No realms available"));
              socket.end();
              return;
            }
            const realm = realms[0]!;
            done = true;
            socket.end();
            resolve({
              sessionKey: srpResult.K,
              realmHost: realm.host,
              realmPort: realm.port,
              realmId: realm.id,
            });
          }
        },
        close() {
          if (!done) reject(new Error("Auth connection closed"));
        },
      },
    }).catch(reject);
  });
}

export function worldSession(
  config: ClientConfig,
  auth: AuthResult,
): Promise<WorldHandle> {
  return new Promise((resolve, reject) => {
    const dispatch = new OpcodeDispatch();
    const buf = new AccumulatorBuffer();
    let arc4: Arc4 | undefined;
    let pingInterval: ReturnType<typeof setInterval>;
    let socket: Awaited<ReturnType<typeof Bun.connect>>;
    const startTime = Date.now();
    let done = false;
    let closedResolve: () => void;
    const closed = new Promise<void>((r) => {
      closedResolve = r;
    });

    dispatch.on(GameOpcode.SMSG_TIME_SYNC_REQ, (r) => {
      const counter = r.uint32LE();
      const elapsed = Date.now() - startTime;
      const w = new PacketWriter();
      w.uint32LE(counter);
      w.uint32LE(elapsed);
      socket.write(
        buildOutgoingPacket(GameOpcode.CMSG_TIME_SYNC_RESP, w.finish(), arc4),
      );
    });

    let pendingHeader: { size: number; opcode: number } | undefined;

    function processPackets() {
      while (true) {
        if (!pendingHeader) {
          if (buf.length < INCOMING_HEADER_SIZE) break;
          const headerBytes = buf.drain(INCOMING_HEADER_SIZE);
          pendingHeader = decryptIncomingHeader(headerBytes, arc4);
        }
        const bodySize = pendingHeader.size - 2;
        if (buf.length < bodySize) break;
        const { opcode } = pendingHeader;
        pendingHeader = undefined;
        const body = buf.drain(bodySize);
        const reader = new PacketReader(body);
        dispatch.handle(opcode, reader);
      }
    }

    async function login() {
      const challengeReader = await dispatch.expect(
        GameOpcode.SMSG_AUTH_CHALLENGE,
      );
      challengeReader.uint32LE();
      const serverSeed = challengeReader.bytes(4);

      const body = await buildWorldAuthPacket(
        config.account,
        auth.sessionKey,
        serverSeed,
        auth.realmId,
        config.clientSeed,
      );
      socket.write(buildOutgoingPacket(GameOpcode.CMSG_AUTH_SESSION, body));

      arc4 = new Arc4(auth.sessionKey);

      const authReader = await dispatch.expect(GameOpcode.SMSG_AUTH_RESPONSE);
      const authStatus = authReader.uint8();
      if (authStatus !== 0x0c) {
        throw new Error(
          `World auth failed: status 0x${authStatus.toString(16)}`,
        );
      }

      socket.write(
        buildOutgoingPacket(GameOpcode.CMSG_CHAR_ENUM, new Uint8Array(0), arc4),
      );

      const enumReader = await dispatch.expect(GameOpcode.SMSG_CHAR_ENUM);
      const chars = parseCharacterList(enumReader);
      const char = chars.find(
        (c) => c.name.toLowerCase() === config.character.toLowerCase(),
      );
      if (!char) {
        throw new Error(
          `Character "${config.character}" not found. Available: ${chars.map((c) => c.name).join(", ")}`,
        );
      }

      const loginBody = new PacketWriter();
      loginBody.uint32LE(char.guidLow);
      loginBody.uint32LE(char.guidHigh);
      socket.write(
        buildOutgoingPacket(
          GameOpcode.CMSG_PLAYER_LOGIN,
          loginBody.finish(),
          arc4,
        ),
      );

      await dispatch.expect(GameOpcode.SMSG_LOGIN_VERIFY_WORLD);

      pingInterval = setInterval(() => {
        const w = new PacketWriter();
        w.uint32LE(0);
        w.uint32LE(0);
        socket.write(
          buildOutgoingPacket(GameOpcode.CMSG_PING, w.finish(), arc4),
        );
      }, config.pingIntervalMs ?? 30_000);

      done = true;
      resolve({
        closed,
        close() {
          clearInterval(pingInterval);
          socket.end();
        },
      });
    }

    login().catch((err) => {
      done = true;
      clearInterval(pingInterval);
      reject(err);
      socket?.end();
    });

    Bun.connect({
      hostname: auth.realmHost,
      port: auth.realmPort,
      socket: {
        open(s) {
          socket = s;
        },
        data(_s, data) {
          buf.append(new Uint8Array(data));
          processPackets();
        },
        close() {
          clearInterval(pingInterval);
          if (!done) reject(new Error("World connection closed"));
          closedResolve();
        },
      },
    }).catch(reject);
  });
}
