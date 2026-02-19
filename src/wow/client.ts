import type { Socket } from "bun";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { SRP, type SRPResult } from "wow/crypto/srp";
import { Arc4 } from "wow/crypto/arc4";
import {
  GameOpcode,
  ChatType,
  Language,
  AuthOpcode,
} from "wow/protocol/opcodes";
import {
  parseChatMessage,
  buildChatMessage,
  buildNameQuery,
  parseNameQueryResponse,
  parseChannelNotify,
  buildWhoRequest,
  parseWhoResponse,
  type ChatMessage as RawChatMessage,
  type WhoResult,
} from "wow/protocol/chat";
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
import {
  buildWorldAuthPacket,
  parseCharacterList,
  OpcodeDispatch,
  AccumulatorBuffer,
  INCOMING_HEADER_SIZE,
  buildOutgoingPacket,
  decryptIncomingHeader,
} from "wow/protocol/world";
import {
  buildGroupInvite,
  buildGroupAccept,
  buildGroupDecline,
  buildGroupUninvite,
  buildGroupDisband,
  buildGroupSetLeader,
  parsePartyCommandResult,
  parseGroupInvite,
  parseGroupSetLeader,
  parseGroupDecline,
  parseGroupList,
  parsePartyMemberStats,
} from "wow/protocol/group";

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
  cachedSessionKey?: Uint8Array;
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

export type GroupEvent =
  | { type: "invite_received"; from: string }
  | {
      type: "command_result";
      operation: number;
      target: string;
      result: number;
    }
  | { type: "leader_changed"; name: string }
  | {
      type: "group_list";
      members: Array<{
        name: string;
        guidLow: number;
        guidHigh: number;
        online: boolean;
      }>;
      leader: string;
    }
  | { type: "group_destroyed" }
  | { type: "kicked" }
  | { type: "invite_declined"; name: string }
  | {
      type: "member_stats";
      guidLow: number;
      online?: boolean;
      hp?: number;
      maxHp?: number;
      level?: number;
    };

export type { WhoResult };

export type ChatMode =
  | { type: "say" }
  | { type: "yell" }
  | { type: "guild" }
  | { type: "party" }
  | { type: "raid" }
  | { type: "whisper"; target: string }
  | { type: "channel"; channel: string };

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
  getChannel(index: number): string | undefined;
  who(opts?: {
    name?: string;
    minLevel?: number;
    maxLevel?: number;
  }): Promise<WhoResult[]>;
  getLastChatMode(): ChatMode;
  setLastChatMode(mode: ChatMode): void;
  sendInCurrentMode(message: string): void;
  invite(name: string): void;
  uninvite(name: string): void;
  leaveGroup(): void;
  setLeader(name: string): void;
  acceptInvite(): void;
  declineInvite(): void;
  onGroupEvent(cb: (event: GroupEvent) => void): void;
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
  channels: string[];
  lastChatMode: ChatMode;
  onMessage?: (msg: ChatMessage) => void;
  selfName: string;
  selfGuidLow: number;
  selfGuidHigh: number;
  partyMembers: Map<string, { guidLow: number; guidHigh: number }>;
  onGroupEvent?: (event: GroupEvent) => void;
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

export class ReconnectRequiredError extends Error {
  constructor() {
    super("Server requires reconnect but no cached session key is available");
    this.name = "ReconnectRequiredError";
  }
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

export function authHandshake(config: ClientConfig): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const buf = new AccumulatorBuffer();
    const srp = new SRP(config.account, config.password);
    let state: "challenge" | "proof" | "reconnect_proof" | "realms" =
      "challenge";
    let srpResult: SRPResult;
    let resolvedSessionKey: Uint8Array;
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
              const opcode = raw[0];
              if (opcode === AuthOpcode.RECONNECT_CHALLENGE) {
                const proofPacket = handleReconnectChallenge(raw, config);
                buf.drain(buf.length);
                resolvedSessionKey = config.cachedSessionKey!;
                socket.write(proofPacket);
                state = "reconnect_proof";
              } else {
                srpResult = handleChallenge(raw, config, srp);
                buf.drain(buf.length);
                resolvedSessionKey = srpResult.K;
                socket.write(buildLogonProof(srpResult));
                state = "proof";
              }
            } else if (state === "proof") {
              handleProof(raw, srpResult);
              buf.drain(buf.length);
              socket.write(buildRealmListRequest());
              state = "realms";
            } else if (state === "reconnect_proof") {
              const r = new PacketReader(raw);
              r.skip(1);
              const status = r.uint8();
              if (status !== 0x00) {
                throw new Error(
                  `Reconnect proof failed: status 0x${status.toString(16)}`,
                );
              }
              buf.drain(buf.length);
              socket.write(buildRealmListRequest());
              state = "realms";
            } else if (state === "realms") {
              const { realmHost, realmPort, realmId } = handleRealms(raw);
              buf.drain(buf.length);
              done = true;
              socket.end();
              resolve({
                sessionKey: resolvedSessionKey,
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
  const pending = conn.pendingMessages.get(result.guidLow);
  if (!pending) return;

  const name = result.found && result.name ? result.name : "";
  if (result.found && result.name)
    conn.nameCache.set(result.guidLow, result.name);
  for (const raw of pending) deliverMessage(conn, raw, name);
  conn.pendingMessages.delete(result.guidLow);
}

function handleChannelNotify(conn: WorldConn, r: PacketReader): void {
  const event = parseChannelNotify(r);
  if (event.type === "joined") {
    conn.channels.push(event.channel);
  } else if (event.type === "left") {
    const idx = conn.channels.indexOf(event.channel);
    if (idx !== -1) conn.channels.splice(idx, 1);
  }
}

function handleMotd(conn: WorldConn, r: PacketReader): void {
  const lineCount = r.uint32LE();
  const lines: string[] = [];
  for (let i = 0; i < lineCount; i++) {
    lines.push(r.cString());
  }
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message: lines.join("\n"),
  });
}

function handlePlayerNotFound(conn: WorldConn, r: PacketReader): void {
  const name = r.cString();
  conn.onMessage?.({
    type: ChatType.SYSTEM,
    sender: "",
    message: `No player named "${name}" is currently playing.`,
  });
}

function handlePartyCommandResult(conn: WorldConn, r: PacketReader): void {
  const result = parsePartyCommandResult(r);
  conn.onGroupEvent?.({
    type: "command_result",
    operation: result.operation,
    target: result.member,
    result: result.result,
  });
}

function handleGroupInviteReceived(conn: WorldConn, r: PacketReader): void {
  const invite = parseGroupInvite(r);
  conn.onGroupEvent?.({ type: "invite_received", from: invite.name });
}

function handleGroupSetLeaderMsg(conn: WorldConn, r: PacketReader): void {
  const { name } = parseGroupSetLeader(r);
  conn.onGroupEvent?.({ type: "leader_changed", name });
}

function handleGroupListMsg(conn: WorldConn, r: PacketReader): void {
  const list = parseGroupList(r);
  conn.partyMembers.clear();
  let leaderName = "";
  if (
    conn.selfGuidLow === list.leaderGuidLow &&
    conn.selfGuidHigh === list.leaderGuidHigh
  ) {
    leaderName = conn.selfName;
  }
  for (const m of list.members) {
    conn.partyMembers.set(m.name, {
      guidLow: m.guidLow,
      guidHigh: m.guidHigh,
    });
    if (
      m.guidLow === list.leaderGuidLow &&
      m.guidHigh === list.leaderGuidHigh
    ) {
      leaderName = m.name;
    }
  }
  conn.onGroupEvent?.({
    type: "group_list",
    members: list.members,
    leader: leaderName,
  });
}

function handleGroupDestroyed(conn: WorldConn): void {
  conn.partyMembers.clear();
  conn.onGroupEvent?.({ type: "group_destroyed" });
}

function handleGroupUninvite(conn: WorldConn): void {
  conn.partyMembers.clear();
  conn.onGroupEvent?.({ type: "kicked" });
}

function handleGroupDeclineMsg(conn: WorldConn, r: PacketReader): void {
  const { name } = parseGroupDecline(r);
  conn.onGroupEvent?.({ type: "invite_declined", name });
}

function handlePartyMemberStatsMsg(
  conn: WorldConn,
  r: PacketReader,
  isFull = false,
): void {
  const stats = parsePartyMemberStats(r, isFull);
  conn.onGroupEvent?.({
    type: "member_stats",
    guidLow: stats.guidLow,
    online: stats.online,
    hp: stats.hp,
    maxHp: stats.maxHp,
    level: stats.level,
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
  if (status !== 0x0c) {
    const names: Record<number, string> = {
      0x0d: "system error",
      0x15: "account in use",
    };
    const label = names[status] ?? `status 0x${status.toString(16)}`;
    throw new Error(`World auth failed: ${label}`);
  }
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

  conn.selfName = char.name;
  conn.selfGuidLow = char.guidLow;
  conn.selfGuidHigh = char.guidHigh;

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
      channels: [],
      lastChatMode: { type: "say" },
      selfName: "",
      selfGuidLow: 0,
      selfGuidHigh: 0,
      partyMembers: new Map(),
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
    conn.dispatch.on(GameOpcode.SMSG_MOTD, (r) => handleMotd(conn, r));
    conn.dispatch.on(GameOpcode.SMSG_CHAT_PLAYER_NOT_FOUND, (r) =>
      handlePlayerNotFound(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_CHANNEL_NOTIFY, (r) =>
      handleChannelNotify(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_PARTY_COMMAND_RESULT, (r) =>
      handlePartyCommandResult(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_GROUP_INVITE, (r) =>
      handleGroupInviteReceived(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_GROUP_SET_LEADER, (r) =>
      handleGroupSetLeaderMsg(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_GROUP_LIST, (r) =>
      handleGroupListMsg(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_GROUP_DESTROYED, () =>
      handleGroupDestroyed(conn),
    );
    conn.dispatch.on(GameOpcode.SMSG_GROUP_UNINVITE, () =>
      handleGroupUninvite(conn),
    );
    conn.dispatch.on(GameOpcode.SMSG_GROUP_DECLINE, (r) =>
      handleGroupDeclineMsg(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_PARTY_MEMBER_STATS, (r) =>
      handlePartyMemberStatsMsg(conn, r),
    );
    conn.dispatch.on(GameOpcode.SMSG_PARTY_MEMBER_STATS_FULL, (r) =>
      handlePartyMemberStatsMsg(conn, r, true),
    );

    async function login() {
      await authenticateWorld(conn, config, auth);
      await selectCharacter(conn, config);
      pingInterval = startPingLoop(conn, config.pingIntervalMs ?? 30_000);
      const lang = config.language ?? Language.COMMON;
      done = true;
      const handle: WorldHandle = {
        closed,
        close() {
          clearInterval(pingInterval);
          conn.socket.end();
        },
        onMessage(cb) {
          conn.onMessage = cb;
        },
        sendWhisper(target, message) {
          if (target) conn.lastChatMode = { type: "whisper", target };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.WHISPER, lang, message, target),
          );
        },
        sendSay(message) {
          conn.lastChatMode = { type: "say" };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.SAY, lang, message),
          );
        },
        sendYell(message) {
          conn.lastChatMode = { type: "yell" };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.YELL, lang, message),
          );
        },
        sendGuild(message) {
          conn.lastChatMode = { type: "guild" };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.GUILD, lang, message),
          );
        },
        sendParty(message) {
          conn.lastChatMode = { type: "party" };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.PARTY, lang, message),
          );
        },
        sendRaid(message) {
          conn.lastChatMode = { type: "raid" };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.RAID, lang, message),
          );
        },
        sendChannel(channel, message) {
          conn.lastChatMode = { type: "channel", channel };
          sendPacket(
            conn,
            GameOpcode.CMSG_MESSAGE_CHAT,
            buildChatMessage(ChatType.CHANNEL, lang, message, channel),
          );
        },
        getChannel(index) {
          return conn.channels[index - 1];
        },
        async who(opts = {}) {
          sendPacket(conn, GameOpcode.CMSG_WHO, buildWhoRequest(opts));
          const r = await conn.dispatch.expect(GameOpcode.SMSG_WHO);
          return parseWhoResponse(r);
        },
        getLastChatMode() {
          return conn.lastChatMode;
        },
        setLastChatMode(mode) {
          conn.lastChatMode = mode;
        },
        sendInCurrentMode(message) {
          const mode = conn.lastChatMode;
          switch (mode.type) {
            case "say":
              handle.sendSay(message);
              break;
            case "yell":
              handle.sendYell(message);
              break;
            case "guild":
              handle.sendGuild(message);
              break;
            case "party":
              handle.sendParty(message);
              break;
            case "raid":
              handle.sendRaid(message);
              break;
            case "whisper":
              handle.sendWhisper(mode.target, message);
              break;
            case "channel":
              handle.sendChannel(mode.channel, message);
              break;
          }
        },
        invite(name) {
          sendPacket(
            conn,
            GameOpcode.CMSG_GROUP_INVITE,
            buildGroupInvite(name),
          );
        },
        uninvite(name) {
          sendPacket(
            conn,
            GameOpcode.CMSG_GROUP_UNINVITE,
            buildGroupUninvite(name),
          );
        },
        leaveGroup() {
          sendPacket(conn, GameOpcode.CMSG_GROUP_DISBAND, buildGroupDisband());
        },
        setLeader(name) {
          const member = conn.partyMembers.get(name);
          if (!member) {
            conn.onMessage?.({
              type: ChatType.SYSTEM,
              sender: "",
              message: `"${name}" is not in your party.`,
            });
            return;
          }
          sendPacket(
            conn,
            GameOpcode.CMSG_GROUP_SET_LEADER,
            buildGroupSetLeader(member.guidLow, member.guidHigh),
          );
        },
        acceptInvite() {
          sendPacket(conn, GameOpcode.CMSG_GROUP_ACCEPT, buildGroupAccept());
        },
        declineInvite() {
          sendPacket(conn, GameOpcode.CMSG_GROUP_DECLINE, buildGroupDecline());
        },
        onGroupEvent(cb) {
          conn.onGroupEvent = cb;
        },
      };
      resolve(handle);
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
