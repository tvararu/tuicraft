import type { Socket } from "bun";
import { PacketReader, PacketWriter } from "protocol/packet";
import { SRP, type SRPResult } from "crypto/srp";
import { Arc4 } from "crypto/arc4";
import { GameOpcode, ChatType, Language } from "protocol/opcodes";
import {
  parseChatMessage,
  buildChatMessage,
  buildNameQuery,
  parseNameQueryResponse,
  buildWhoRequest,
  parseWhoResponse,
  type ChatMessage as RawChatMessage,
  type WhoResult,
} from "protocol/chat";
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

export type ClientConfig = {
  host: string;
  port: number;
  account: string;
  password: string;
  character: string;
  srpPrivateKey?: bigint;
  clientSeed?: Uint8Array;
  pingIntervalMs?: number;
  language?: number;
};

export type AuthResult = {
  sessionKey: Uint8Array;
  realmHost: string;
  realmPort: number;
  realmId: number;
};

export type ChatMessage = {
  type: number;
  sender: string;
  message: string;
  channel?: string;
};

export type { WhoResult };

export type WorldHandle = {
  closed: Promise<void>;
  close(): void;
  onMessage(cb: (msg: ChatMessage) => void): void;
  sendWhisper(target: string, message: string): void;
  sendSay(message: string): void;
  sendYell(message: string): void;
  sendGuild(message: string): void;
  sendParty(message: string): void;
  sendRaid(message: string): void;
  sendChannel(channel: string, message: string): void;
  who(opts?: {
    name?: string;
    minLevel?: number;
    maxLevel?: number;
  }): Promise<WhoResult[]>;
};

type WorldConn = {
  socket: Socket;
  dispatch: OpcodeDispatch;
  buf: AccumulatorBuffer;
  arc4?: Arc4;
  startTime: number;
  pendingHeader?: { size: number; opcode: number };
  nameCache: Map<number, string>;
  pendingMessages: Map<number, RawChatMessage[]>;
  onMessage?: (msg: ChatMessage) => void;
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

export function authHandshake(config: ClientConfig): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const buf = new AccumulatorBuffer();
    const srp = new SRP(config.account, config.password);
    let state: "challenge" | "proof" | "realms" = "challenge";
    let srpResult: SRPResult;
    let done = false;

    function fail(err: unknown, socket: Socket) {
      done = true;
      reject(err);
      socket.end();
    }

    Bun.connect({
      hostname: config.host,
      port: config.port,
      socket: {
        open(socket) {
          socket.write(buildLogonChallenge(config.account));
        },
        data(socket, data) {
          buf.append(new Uint8Array(data));

          try {
            const raw = buf.peek(buf.length);
            if (state === "challenge") {
              srpResult = handleChallenge(raw, config, srp);
              buf.drain(buf.length);
              socket.write(buildLogonProof(srpResult));
              state = "proof";
            } else if (state === "proof") {
              handleProof(raw, srpResult);
              buf.drain(buf.length);
              socket.write(buildRealmListRequest());
              state = "realms";
            } else if (state === "realms") {
              const { realmHost, realmPort, realmId } = handleRealms(raw);
              buf.drain(buf.length);
              done = true;
              socket.end();
              resolve({
                sessionKey: srpResult.K,
                realmHost,
                realmPort,
                realmId,
              });
            }
          } catch (err) {
            if (err instanceof RangeError) return;
            fail(err, socket);
          }
        },
        close() {
          if (!done) reject(new Error("Auth connection closed"));
        },
      },
    }).catch(reject);
  });
}

function sendPacket(
  conn: WorldConn,
  opcode: number,
  body: Uint8Array = new Uint8Array(0),
): void {
  conn.socket.write(buildOutgoingPacket(opcode, body, conn.arc4));
}

function drainWorldPackets(conn: WorldConn): void {
  while (true) {
    if (!conn.pendingHeader) {
      if (conn.buf.length < INCOMING_HEADER_SIZE) break;
      conn.pendingHeader = decryptIncomingHeader(
        conn.buf.drain(INCOMING_HEADER_SIZE),
        conn.arc4,
      );
    }
    const bodySize = conn.pendingHeader.size - 2;
    if (conn.buf.length < bodySize) break;

    const { opcode } = conn.pendingHeader;
    conn.pendingHeader = undefined;
    try {
      conn.dispatch.handle(opcode, new PacketReader(conn.buf.drain(bodySize)));
    } catch (err) {
      if (err instanceof Error) {
        process.stderr.write(
          `opcode 0x${opcode.toString(16)} size=${bodySize}: ${err.message}\n`,
        );
      }
    }
  }
}

function handleTimeSync(conn: WorldConn, r: PacketReader): void {
  const counter = r.uint32LE();
  const elapsed = Date.now() - conn.startTime;
  const w = new PacketWriter();
  w.uint32LE(counter);
  w.uint32LE(elapsed);
  sendPacket(conn, GameOpcode.CMSG_TIME_SYNC_RESP, w.finish());
}

function deliverMessage(
  conn: WorldConn,
  raw: RawChatMessage,
  name: string,
): void {
  conn.onMessage?.({
    type: raw.type,
    sender: name,
    message: raw.message,
    channel: raw.channel,
  });
}

function handleChatMessage(conn: WorldConn, r: PacketReader): void {
  const raw = parseChatMessage(r);

  if (raw.senderGuidLow === 0) {
    deliverMessage(conn, raw, "");
    return;
  }

  const cached = conn.nameCache.get(raw.senderGuidLow);
  if (cached !== undefined) {
    deliverMessage(conn, raw, cached);
    return;
  }

  const pending = conn.pendingMessages.get(raw.senderGuidLow);
  if (pending) {
    pending.push(raw);
  } else {
    conn.pendingMessages.set(raw.senderGuidLow, [raw]);
    sendPacket(
      conn,
      GameOpcode.CMSG_NAME_QUERY,
      buildNameQuery(raw.senderGuidLow, raw.senderGuidHigh),
    );
  }
}

function handleGmChatMessage(conn: WorldConn, r: PacketReader): void {
  const raw = parseChatMessage(r, true);
  deliverMessage(conn, raw, raw.senderName ?? "");
}

function handleNameQueryResponse(conn: WorldConn, r: PacketReader): void {
  const result = parseNameQueryResponse(r);
  if (!result.found || !result.name) return;

  conn.nameCache.set(result.guidLow, result.name);
  const pending = conn.pendingMessages.get(result.guidLow);
  if (pending) {
    for (const raw of pending) deliverMessage(conn, raw, result.name);
    conn.pendingMessages.delete(result.guidLow);
  }
}

function handlePlayerNotFound(conn: WorldConn, r: PacketReader): void {
  const name = r.cString();
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message: `No player named "${name}" is currently playing.`,
  });
}

async function authenticateWorld(
  conn: WorldConn,
  config: ClientConfig,
  auth: AuthResult,
): Promise<void> {
  const challenge = await conn.dispatch.expect(GameOpcode.SMSG_AUTH_CHALLENGE);
  challenge.uint32LE();
  const serverSeed = challenge.bytes(4);

  const body = await buildWorldAuthPacket(
    config.account,
    auth.sessionKey,
    serverSeed,
    auth.realmId,
    config.clientSeed,
  );
  conn.socket.write(buildOutgoingPacket(GameOpcode.CMSG_AUTH_SESSION, body));
  conn.arc4 = new Arc4(auth.sessionKey);

  const resp = await conn.dispatch.expect(GameOpcode.SMSG_AUTH_RESPONSE);
  const status = resp.uint8();
  if (status !== 0x0c)
    throw new Error(`World auth failed: status 0x${status.toString(16)}`);
}

async function selectCharacter(
  conn: WorldConn,
  config: ClientConfig,
): Promise<void> {
  sendPacket(conn, GameOpcode.CMSG_CHAR_ENUM);

  const enumReader = await conn.dispatch.expect(GameOpcode.SMSG_CHAR_ENUM);
  const chars = parseCharacterList(enumReader);
  const char = chars.find(
    (c) => c.name.toLowerCase() === config.character.toLowerCase(),
  );
  if (!char) {
    throw new Error(
      `Character "${config.character}" not found. Available: ${chars.map((c) => c.name).join(", ")}`,
    );
  }

  const w = new PacketWriter();
  w.uint32LE(char.guidLow);
  w.uint32LE(char.guidHigh);
  sendPacket(conn, GameOpcode.CMSG_PLAYER_LOGIN, w.finish());

  await conn.dispatch.expect(GameOpcode.SMSG_LOGIN_VERIFY_WORLD);
}

function startPingLoop(
  conn: WorldConn,
  intervalMs: number,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const w = new PacketWriter();
    w.uint32LE(0);
    w.uint32LE(0);
    sendPacket(conn, GameOpcode.CMSG_PING, w.finish());
  }, intervalMs);
}

export function worldSession(
  config: ClientConfig,
  auth: AuthResult,
): Promise<WorldHandle> {
  return new Promise((resolve, reject) => {
    const conn: WorldConn = {
      socket: undefined!,
      dispatch: new OpcodeDispatch(),
      buf: new AccumulatorBuffer(),
      startTime: Date.now(),
      nameCache: new Map(),
      pendingMessages: new Map(),
    };
    let pingInterval: ReturnType<typeof setInterval>;
    let done = false;
    let closedResolve: () => void;
    const closed = new Promise<void>((r) => {
      closedResolve = r;
    });

    conn.dispatch.on(GameOpcode.SMSG_TIME_SYNC_REQ, (r) =>
      handleTimeSync(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_MESSAGE_CHAT, (r) =>
      handleChatMessage(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_GM_MESSAGECHAT, (r) =>
      handleGmChatMessage(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_NAME_QUERY_RESPONSE, (r) =>
      handleNameQueryResponse(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_CHAT_PLAYER_NOT_FOUND, (r) =>
      handlePlayerNotFound(conn, r),
    );

    async function login() {
      await authenticateWorld(conn, config, auth);
      await selectCharacter(conn, config);
      pingInterval = startPingLoop(conn, config.pingIntervalMs ?? 30_000);
      const lang = config.language ?? Language.COMMON;
      done = true;
      resolve({
        closed,
        close() {
          clearInterval(pingInterval);
          conn.socket.end();
        },
        onMessage(cb) {
          conn.onMessage = cb;
        },
        sendWhisper(target, message) {
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.WHISPER, lang, message, target),
          );
        },
        sendSay(message) {
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.SAY, lang, message),
          );
        },
        sendYell(message) {
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.YELL, lang, message),
          );
        },
        sendGuild(message) {
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.GUILD, lang, message),
          );
        },
        sendParty(message) {
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.PARTY, lang, message),
          );
        },
        sendRaid(message) {
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.RAID, lang, message),
          );
        },
        sendChannel(channel, message) {
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.CHANNEL, lang, message, channel),
          );
        },
        async who(opts = {}) {
          sendPacket(conn, GameOpcode.CMSG_WHO, buildWhoRequest(opts));
          const r = await conn.dispatch.expect(GameOpcode.SMSG_WHO);
          return parseWhoResponse(r);
        },
      });
    }

    login().catch((err) => {
      done = true;
      clearInterval(pingInterval);
      reject(err);
      conn.socket?.end();
    });

    Bun.connect({
      hostname: auth.realmHost,
      port: auth.realmPort,
      socket: {
        open(s) {
          conn.socket = s;
        },
        data(_s, data) {
          conn.buf.append(new Uint8Array(data));
          drainWorldPackets(conn);
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
