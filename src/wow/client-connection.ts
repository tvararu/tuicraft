import type { AuthResult } from "wow/auth";
import type { ClientConfig, WorldConn } from "wow/client";
import { Arc4 } from "wow/crypto/arc4";
import { EntityStore, isUnit } from "wow/entity-store";
import { FriendStore } from "wow/friend-store";
import { GuildStore } from "wow/guild-store";
import { IgnoreStore } from "wow/ignore-store";
import { ObjectType } from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import {
  AccumulatorBuffer,
  buildOutgoingPacket,
  buildWorldAuthPacket,
  CLASS_NAMES,
  decryptIncomingHeader,
  INCOMING_HEADER_SIZE,
  OpcodeDispatch,
  parseCharacterList,
} from "wow/protocol/world";
import { RemoteMotion } from "wow/remote-motion";
import type { Runtimes } from "wow/runtime";
import { clearWorldEvents, createWorldEvents } from "wow/world-events";
import { selfGuid, sendPacket } from "wow/world-handlers";

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
    conn.dispatchingOpcode = opcode;
    try {
      conn.dispatch.handle(opcode, new PacketReader(conn.buf.drain(bodySize)));
    } catch (err) {
      if (err instanceof Error) {
        conn.events.packetError.emit(opcode, err);
      }
    } finally {
      conn.dispatchingOpcode = undefined;
    }
  }
}

function reportListenerError(conn: WorldConn, error: unknown): void {
  if (conn.dispatchingOpcode === undefined) throw error;
  if (error instanceof Error)
    conn.events.packetError.emit(conn.dispatchingOpcode, error);
}

export async function authenticateWorld(
  conn: WorldConn,
  config: ClientConfig,
  auth: AuthResult,
): Promise<void> {
  const challenge = await conn.dispatch.expect(GameOpcode.SMSG_AUTH_CHALLENGE);
  challenge.uint32LE();
  const serverSeed = challenge.bytes(4);

  const body = buildWorldAuthPacket({
    account: config.account,
    sessionKey: auth.sessionKey,
    serverSeed,
    realmId: auth.realmId,
    clientSeed: config.clientSeed,
  });
  if (!conn.socket) throw new Error("World socket is not connected");
  conn.socket.write(buildOutgoingPacket(GameOpcode.CMSG_AUTH_SESSION, body));
  conn.arc4 = new Arc4(auth.sessionKey);

  const resp = await conn.dispatch.expect(GameOpcode.SMSG_AUTH_RESPONSE);
  const status = resp.uint8();
  if (status !== 0x0c) {
    const names: Record<number, string> = {
      13: "system error",
      21: "account in use",
    };
    const label = names[status] ?? `status 0x${status.toString(16)}`;
    throw new Error(`World auth failed: ${label}`);
  }
}

export async function selectCharacter(
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
  conn.selfClass = CLASS_NAMES[char.classId];
  conn.selfGuidLow = char.guidLow;
  conn.selfGuidHigh = char.guidHigh;
  conn.guildId = char.guildId;

  const w = new PacketWriter();
  w.uint32LE(char.guidLow);
  w.uint32LE(char.guidHigh);
  sendPacket(conn, GameOpcode.CMSG_PLAYER_LOGIN, w.finish());
  if (!conn.control) throw new Error("no_control");
  await conn.control.waitLogin();
}

export function startPingLoop(
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

export function createWorldConn(): WorldConn {
  const conn: WorldConn = {
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
    entityStore: new EntityStore(),
    remoteMotion: new RemoteMotion({
      now: () => Date.now(),
      eligible: (guid) =>
        guid !== selfGuid(conn) &&
        conn.entityStore.get(guid)?.objectType === ObjectType.PLAYER,
      dead: (guid) => {
        const entity = conn.entityStore.get(guid);
        return isUnit(entity) && entity.maxHealth > 0 && entity.health === 0;
      },
      emit: (event) => conn.events.remoteMotion.emit(event),
    }),
    creatureNameCache: new Map(),
    gameObjectNameCache: new Map(),
    pendingNameQueries: new Set(),
    friendStore: new FriendStore(),
    ignoreStore: new IgnoreStore(),
    guildStore: new GuildStore(),
    guildId: 0,
    pendingRequest: null,
    duelArbiter: 0n,
    events: createWorldEvents((error) => reportListenerError(conn, error)),
  };
  conn.entityStore.onEvent((event) => {
    if (event.type === "disappear") {
      conn.remoteMotion.forget(event.guid);
      conn.combat?.forget(event.guid);
    }
    conn.recovery?.observeEntity(event);
    conn.rewards?.observeEntity(event);
    conn.cycle?.observeEntity(event);
    conn.events.entity.emit(event);
  });
  conn.friendStore.onEvent((event) => conn.events.friend.emit(event));
  conn.ignoreStore.onEvent((event) => conn.events.ignore.emit(event));
  conn.guildStore.onEvent((event) => conn.events.guild.emit(event));
  return conn;
}

export function cleanupSession(
  conn: WorldConn,
  rt: Runtimes,
  sendStop: boolean,
): void {
  clearWorldEvents(conn.events);
  rt.dispose(sendStop);
}
export function connectWorld(
  conn: WorldConn,
  auth: AuthResult,
  hooks: { close: () => void; reject: (error: unknown) => void },
): void {
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
        hooks.close();
      },
    },
  }).catch(hooks.reject);
}
