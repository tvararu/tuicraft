import type { Socket, TCPSocketListener } from "bun";
import { createHmac, createCipheriv, createDecipheriv } from "node:crypto";
import { PacketReader, PacketWriter } from "protocol/packet";
import { GameOpcode, ChatType, ChannelNotify } from "protocol/opcodes";
import { sessionKey, serverSeed, FIXTURE_CHARACTER } from "test/fixtures";

const ENCRYPT_KEY = "C2B3723CC6AED9B5343C53EE2F4367CE";
const DECRYPT_KEY = "CC98AE04E897EACA12DDC09342915357";

type ConnState = {
  buf: Uint8Array;
  arc4?: ServerArc4;
  pendingHeader?: { size: number; opcode: number };
};

class ServerArc4 {
  private encCipher: ReturnType<typeof createCipheriv>;
  private decCipher: ReturnType<typeof createDecipheriv>;

  constructor(key: Uint8Array) {
    const encKey = createHmac("sha1", Buffer.from(DECRYPT_KEY, "hex"))
      .update(key)
      .digest();
    const decKey = createHmac("sha1", Buffer.from(ENCRYPT_KEY, "hex"))
      .update(key)
      .digest();

    this.encCipher = createCipheriv("rc4", encKey, "");
    this.decCipher = createDecipheriv("rc4", decKey, "");

    const drop = new Uint8Array(1024);
    this.encCipher.update(drop);
    this.decCipher.update(drop);
  }

  encrypt(data: Uint8Array): Uint8Array {
    return new Uint8Array(this.encCipher.update(data));
  }

  decrypt(data: Uint8Array): Uint8Array {
    return new Uint8Array(this.decCipher.update(data));
  }
}

function buildServerPacket(
  opcode: number,
  body: Uint8Array,
  arc4?: ServerArc4,
): Uint8Array {
  const header = new Uint8Array(4);
  const view = new DataView(header.buffer);
  view.setUint16(0, body.byteLength + 2, false);
  view.setUint16(2, opcode, true);

  const encrypted = arc4 ? arc4.encrypt(header) : header;
  const packet = new Uint8Array(4 + body.byteLength);
  packet.set(encrypted);
  packet.set(body, 4);
  return packet;
}

function decryptClientHeader(
  header: Uint8Array,
  arc4?: ServerArc4,
): { size: number; opcode: number } {
  const decrypted = arc4 ? arc4.decrypt(header) : header;
  const view = new DataView(
    decrypted.buffer,
    decrypted.byteOffset,
    decrypted.byteLength,
  );
  return { size: view.getUint16(0, false), opcode: view.getUint32(2, true) };
}

function send(
  socket: Socket<ConnState>,
  opcode: number,
  body: Uint8Array,
): void {
  socket.write(buildServerPacket(opcode, body, socket.data.arc4));
}

function handleAuthSession(
  socket: Socket<ConnState>,
  authStatus: number,
): void {
  socket.data.arc4 = new ServerArc4(sessionKey);
  send(socket, GameOpcode.SMSG_AUTH_RESPONSE, new Uint8Array([authStatus]));
}

function buildCharEnumBody(): Uint8Array {
  const w = new PacketWriter(512);
  w.uint8(1);
  w.uint32LE(0x42);
  w.uint32LE(0x00);
  w.cString(FIXTURE_CHARACTER);
  w.uint8(1);
  w.uint8(1);
  w.uint8(0);
  for (let i = 0; i < 5; i++) w.uint8(0);
  w.uint8(10);
  w.uint32LE(1);
  w.uint32LE(0);
  w.floatLE(0);
  w.floatLE(0);
  w.floatLE(0);
  w.uint32LE(0);
  w.uint32LE(0);
  w.uint32LE(0);
  w.uint8(0);
  w.uint32LE(0);
  w.uint32LE(0);
  w.uint32LE(0);
  for (let i = 0; i < 23; i++) {
    w.uint32LE(0);
    w.uint8(0);
    w.uint32LE(0);
  }
  return w.finish();
}

function handleCharEnum(socket: Socket<ConnState>): void {
  send(socket, GameOpcode.SMSG_CHAR_ENUM, buildCharEnumBody());
}

function buildChannelNotifyJoined(channel: string): Uint8Array {
  const w = new PacketWriter();
  w.uint8(ChannelNotify.YOU_JOINED);
  w.cString(channel);
  w.uint8(0);
  w.uint32LE(0);
  w.uint32LE(0);
  return w.finish();
}

function handlePlayerLogin(
  socket: Socket<ConnState>,
  sendTimeSync: boolean,
): void {
  const w = new PacketWriter();
  w.uint32LE(0);
  w.floatLE(0);
  w.floatLE(0);
  w.floatLE(0);
  w.floatLE(0);
  send(socket, GameOpcode.SMSG_LOGIN_VERIFY_WORLD, w.finish());

  send(
    socket,
    GameOpcode.SMSG_CHANNEL_NOTIFY,
    buildChannelNotifyJoined("General"),
  );
  send(
    socket,
    GameOpcode.SMSG_CHANNEL_NOTIFY,
    buildChannelNotifyJoined("Trade"),
  );

  if (sendTimeSync) {
    const syncW = new PacketWriter();
    syncW.uint32LE(0);
    send(socket, GameOpcode.SMSG_TIME_SYNC_REQ, syncW.finish());
  }
}

function handlePing(socket: Socket<ConnState>, body: Uint8Array): void {
  const seq = new PacketReader(body).uint32LE();
  const w = new PacketWriter();
  w.uint32LE(seq);
  send(socket, GameOpcode.SMSG_PONG, w.finish());
}

function handleMessageChat(socket: Socket<ConnState>, body: Uint8Array): void {
  const r = new PacketReader(body);
  const chatType = r.uint32LE();
  r.uint32LE();
  let target = "";
  if (chatType === ChatType.WHISPER || chatType === ChatType.CHANNEL) {
    target = r.cString();
  }
  const message = r.cString();

  const w = new PacketWriter();
  w.uint8(chatType);
  w.uint32LE(0);
  w.uint32LE(0x42);
  w.uint32LE(0x00);
  w.uint32LE(0);
  if (chatType === ChatType.CHANNEL) w.cString(target);
  w.uint32LE(0x42);
  w.uint32LE(0x00);
  const msgBytes = new TextEncoder().encode(message);
  w.uint32LE(msgBytes.byteLength);
  w.rawBytes(msgBytes);
  w.uint8(0);
  send(socket, GameOpcode.SMSG_MESSAGE_CHAT, w.finish());
}

function handleNameQuery(socket: Socket<ConnState>): void {
  const w = new PacketWriter();
  w.uint8(0x01);
  w.uint8(0x42);
  w.uint8(0);
  w.cString(FIXTURE_CHARACTER);
  w.cString("");
  w.uint32LE(1);
  w.uint32LE(0);
  w.uint32LE(1);
  send(socket, GameOpcode.SMSG_NAME_QUERY_RESPONSE, w.finish());
}

function handleWho(socket: Socket<ConnState>): void {
  const w = new PacketWriter();
  w.uint32LE(1);
  w.uint32LE(1);
  w.cString(FIXTURE_CHARACTER);
  w.cString("");
  w.uint32LE(10);
  w.uint32LE(1);
  w.uint32LE(1);
  w.uint8(0);
  w.uint32LE(1);
  send(socket, GameOpcode.SMSG_WHO, w.finish());
}

function handlePacket(
  socket: Socket<ConnState>,
  opcode: number,
  body: Uint8Array,
  authStatus: number,
  sendTimeSync: boolean,
): void {
  if (opcode === GameOpcode.CMSG_AUTH_SESSION)
    handleAuthSession(socket, authStatus);
  else if (opcode === GameOpcode.CMSG_CHAR_ENUM) handleCharEnum(socket);
  else if (opcode === GameOpcode.CMSG_PLAYER_LOGIN)
    handlePlayerLogin(socket, sendTimeSync);
  else if (opcode === GameOpcode.CMSG_PING) handlePing(socket, body);
  else if (opcode === GameOpcode.CMSG_MESSAGE_CHAT)
    handleMessageChat(socket, body);
  else if (opcode === GameOpcode.CMSG_NAME_QUERY) handleNameQuery(socket);
  else if (opcode === GameOpcode.CMSG_WHO) handleWho(socket);
}

function drainPackets(
  socket: Socket<ConnState>,
  authStatus: number,
  sendTimeSync: boolean,
): void {
  while (true) {
    if (!socket.data.pendingHeader) {
      if (socket.data.buf.byteLength < 6) break;
      const headerBytes = socket.data.buf.slice(0, 6);
      socket.data.buf = socket.data.buf.slice(6);
      socket.data.pendingHeader = decryptClientHeader(
        headerBytes,
        socket.data.arc4,
      );
    }

    const { size, opcode } = socket.data.pendingHeader;
    const bodySize = size - 4;
    if (socket.data.buf.byteLength < bodySize) break;

    const body =
      bodySize > 0 ? socket.data.buf.slice(0, bodySize) : new Uint8Array(0);
    socket.data.buf = socket.data.buf.slice(bodySize);
    socket.data.pendingHeader = undefined;

    handlePacket(socket, opcode, body, authStatus, sendTimeSync);
  }
}

function sendAuthChallenge(socket: Socket<ConnState>): void {
  const w = new PacketWriter();
  w.uint32LE(1);
  w.rawBytes(serverSeed);
  w.rawBytes(new Uint8Array(32));
  socket.write(buildServerPacket(GameOpcode.SMSG_AUTH_CHALLENGE, w.finish()));
}

function appendToBuffer(socket: Socket<ConnState>, data: Uint8Array): void {
  const prev = socket.data.buf;
  const next = new Uint8Array(prev.byteLength + data.byteLength);
  next.set(prev);
  next.set(new Uint8Array(data), prev.byteLength);
  socket.data.buf = next;
}

export function startMockWorldServer(opts?: {
  authStatus?: number;
  sendTimeSyncAfterLogin?: boolean;
}): Promise<{
  port: number;
  stop(): void;
  inject(opcode: number, body: Uint8Array): void;
}> {
  const authStatus = opts?.authStatus ?? 0x0c;
  const sendTimeSync = opts?.sendTimeSyncAfterLogin ?? false;
  let activeSocket: Socket<ConnState> | undefined;

  return new Promise((resolve) => {
    const listener: TCPSocketListener<ConnState> = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      data: { buf: new Uint8Array(0) },
      socket: {
        open(socket) {
          activeSocket = socket;
          sendAuthChallenge(socket);
        },
        data(socket, data) {
          appendToBuffer(socket, new Uint8Array(data));
          drainPackets(socket, authStatus, sendTimeSync);
        },
        close() {
          activeSocket = undefined;
        },
      },
    });

    resolve({
      port: listener.port,
      stop() {
        listener.stop(true);
      },
      inject(opcode: number, body: Uint8Array) {
        if (!activeSocket) throw new Error("No active connection");
        activeSocket.write(
          buildServerPacket(opcode, body, activeSocket.data.arc4),
        );
      },
    });
  });
}
