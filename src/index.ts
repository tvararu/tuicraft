import { parseArgs } from "node:util";
import { PacketReader, PacketWriter } from "./protocol/packet";
import { SRP } from "./crypto/srp";
import { Arc4 } from "./crypto/arc4";
import { GameOpcode } from "./protocol/opcodes";
import {
  buildLogonChallenge,
  parseLogonChallengeResponse,
  buildLogonProof,
  parseLogonProofResponse,
  buildRealmListRequest,
  parseRealmList,
} from "./protocol/auth";
import {
  buildWorldAuthPacket,
  parseCharacterList,
  OpcodeDispatch,
  AccumulatorBuffer,
  INCOMING_HEADER_SIZE,
  buildOutgoingPacket,
  decryptIncomingHeader,
} from "./protocol/world";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    host: { type: "string", default: "t1" },
    port: { type: "string", default: "3724" },
    account: { type: "string" },
    password: { type: "string" },
    character: { type: "string" },
  },
});

if (!values.account || !values.password || !values.character) {
  console.error(
    "Usage: bun src/index.ts --account <account> --password <password> --character <name> [--host <host>] [--port <port>]",
  );
  process.exit(1);
}

const host = values.host!;
const port = parseInt(values.port!, 10);
const account = values.account.toUpperCase();
const password = values.password.toUpperCase();
const character = values.character;

interface AuthResult {
  sessionKey: Uint8Array;
  realmHost: string;
  realmPort: number;
  realmId: number;
}

function authHandshake(): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const buf = new AccumulatorBuffer();
    const srp = new SRP(account, password);
    let state: "challenge" | "proof" | "realms" = "challenge";
    let srpResult: ReturnType<SRP["calculate"]>;

    Bun.connect({
      hostname: host,
      port,
      socket: {
        open(socket) {
          socket.write(buildLogonChallenge(account));
        },
        data(socket, data) {
          buf.append(new Uint8Array(data));

          if (state === "challenge") {
            const raw = buf.drain(buf.length);
            const r = new PacketReader(raw);
            r.skip(1);
            const result = parseLogonChallengeResponse(r);
            if (result.status !== 0x00) {
              socket.end();
              reject(
                new Error(
                  `Auth challenge failed: status 0x${result.status.toString(16)}`,
                ),
              );
              return;
            }
            srpResult = srp.calculate(
              result.g!,
              result.N!,
              result.salt!,
              result.B!,
            );
            socket.write(buildLogonProof(srpResult));
            state = "proof";
          } else if (state === "proof") {
            const raw = buf.drain(buf.length);
            const r = new PacketReader(raw);
            r.skip(1);
            const result = parseLogonProofResponse(r);
            if (result.status !== 0x00) {
              socket.end();
              reject(
                new Error(
                  `Auth proof failed: status 0x${result.status.toString(16)}`,
                ),
              );
              return;
            }
            if (result.M2 !== srpResult.M2) {
              socket.end();
              reject(new Error("Server M2 mismatch"));
              return;
            }
            socket.write(buildRealmListRequest());
            state = "realms";
          } else if (state === "realms") {
            const raw = buf.drain(buf.length);
            const r = new PacketReader(raw, 1);
            const realms = parseRealmList(r);
            if (realms.length === 0) {
              socket.end();
              reject(new Error("No realms available"));
              return;
            }
            const realm = realms[0]!;
            socket.end();
            resolve({
              sessionKey: srpResult.K,
              realmHost: realm.host,
              realmPort: realm.port,
              realmId: realm.id,
            });
          }
        },
        error(_socket, err) {
          reject(err);
        },
        close() {},
      },
    }).catch(reject);
  });
}

function worldSession(auth: AuthResult): Promise<void> {
  return new Promise((resolve, reject) => {
    const dispatch = new OpcodeDispatch();
    const buf = new AccumulatorBuffer();
    let arc4: Arc4 | undefined;
    let pingInterval: ReturnType<typeof setInterval>;
    let socket: Awaited<ReturnType<typeof Bun.connect>>;
    const startTime = Date.now();

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
        account,
        auth.sessionKey,
        serverSeed,
        auth.realmId,
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
        (c) => c.name.toLowerCase() === character.toLowerCase(),
      );
      if (!char) {
        throw new Error(
          `Character "${character}" not found. Available: ${chars.map((c) => c.name).join(", ")}`,
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
      console.log("Logged in.");

      pingInterval = setInterval(() => {
        const w = new PacketWriter();
        w.uint32LE(0);
        w.uint32LE(0);
        socket.write(
          buildOutgoingPacket(GameOpcode.CMSG_PING, w.finish(), arc4),
        );
      }, 30_000);
    }

    login().catch((err) => {
      clearInterval(pingInterval);
      reject(err);
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
        error(_s, err) {
          clearInterval(pingInterval);
          reject(err);
        },
        close() {
          clearInterval(pingInterval);
          resolve();
        },
      },
    }).catch(reject);
  });
}

async function main() {
  console.log(`Connecting to ${host}:${port} as ${account}...`);
  const auth = await authHandshake();
  console.log(`Authenticated. Realm: ${auth.realmHost}:${auth.realmPort}`);
  await worldSession(auth);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
