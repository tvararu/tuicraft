import type { Socket, TCPSocketListener } from "bun";
import { createHmac, createCipheriv, createDecipheriv } from "node:crypto";
import { PacketReader, PacketWriter } from "protocol/packet";
import { GameOpcode } from "protocol/opcodes";
import { sessionKey, serverSeed, FIXTURE_CHARACTER } from "test/fixtures";

const ENCRYPT_KEY = "C2B3723CC6AED9B5343C53EE2F4367CE";
const DECRYPT_KEY = "CC98AE04E897EACA12DDC09342915357";

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
  const size = body.byteLength + 2;
  const header = new Uint8Array(4);
  const view = new DataView(header.buffer);
  view.setUint16(0, size, false);
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
  const size = view.getUint16(0, false);
  const opcode = view.getUint32(2, true);
  return { size, opcode };
}

export function startMockWorldServer(): Promise<{
  port: number;
  stop(): void;
}> {
  return new Promise((resolve) => {
    let listener: TCPSocketListener<{
      buf: Uint8Array;
      arc4?: ServerArc4;
      pendingHeader?: { size: number; opcode: number };
    }>;

    listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      data: {
        buf: new Uint8Array(0),
        arc4: undefined,
        pendingHeader: undefined,
      },
      socket: {
        open(
          socket: Socket<{
            buf: Uint8Array;
            arc4?: ServerArc4;
            pendingHeader?: { size: number; opcode: number };
          }>,
        ) {
          const w = new PacketWriter();
          w.uint32LE(1);
          w.rawBytes(serverSeed);
          w.rawBytes(new Uint8Array(32));
          const body = w.finish();

          socket.write(buildServerPacket(GameOpcode.SMSG_AUTH_CHALLENGE, body));
        },
        data(
          socket: Socket<{
            buf: Uint8Array;
            arc4?: ServerArc4;
            pendingHeader?: { size: number; opcode: number };
          }>,
          data: Uint8Array,
        ) {
          const prev = socket.data.buf;
          const next = new Uint8Array(prev.byteLength + data.byteLength);
          next.set(prev);
          next.set(new Uint8Array(data), prev.byteLength);
          socket.data.buf = next;

          while (true) {
            const buf = socket.data.buf;
            if (!socket.data.pendingHeader) {
              if (buf.byteLength < 6) break;
              const headerBytes = buf.slice(0, 6);
              socket.data.buf = buf.slice(6);
              socket.data.pendingHeader = decryptClientHeader(
                headerBytes,
                socket.data.arc4,
              );
            }

            const { size, opcode } = socket.data.pendingHeader;
            const bodySize = size - 4;
            if (socket.data.buf.byteLength < bodySize) break;

            const body =
              bodySize > 0
                ? socket.data.buf.slice(0, bodySize)
                : new Uint8Array(0);
            socket.data.buf = socket.data.buf.slice(bodySize);
            socket.data.pendingHeader = undefined;

            handlePacket(socket, opcode, body);
          }
        },
        close() {},
        error() {},
      },
    });

    function handlePacket(
      socket: Socket<{
        buf: Uint8Array;
        arc4?: ServerArc4;
        pendingHeader?: { size: number; opcode: number };
      }>,
      opcode: number,
      body: Uint8Array,
    ) {
      if (opcode === GameOpcode.CMSG_AUTH_SESSION) {
        socket.data.arc4 = new ServerArc4(sessionKey);

        const resp = new Uint8Array([0x0c]);
        socket.write(
          buildServerPacket(
            GameOpcode.SMSG_AUTH_RESPONSE,
            resp,
            socket.data.arc4,
          ),
        );
      } else if (opcode === GameOpcode.CMSG_CHAR_ENUM) {
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
        socket.write(
          buildServerPacket(
            GameOpcode.SMSG_CHAR_ENUM,
            w.finish(),
            socket.data.arc4,
          ),
        );
      } else if (opcode === GameOpcode.CMSG_PLAYER_LOGIN) {
        const w = new PacketWriter();
        w.uint32LE(0);
        w.floatLE(0);
        w.floatLE(0);
        w.floatLE(0);
        w.floatLE(0);
        socket.write(
          buildServerPacket(
            GameOpcode.SMSG_LOGIN_VERIFY_WORLD,
            w.finish(),
            socket.data.arc4,
          ),
        );
      } else if (opcode === GameOpcode.CMSG_PING) {
        const r = new PacketReader(body);
        const seq = r.uint32LE();
        const w = new PacketWriter();
        w.uint32LE(seq);
        socket.write(
          buildServerPacket(GameOpcode.SMSG_PONG, w.finish(), socket.data.arc4),
        );
      }
    }

    resolve({
      port: listener.port,
      stop() {
        listener.stop(true);
      },
    });
  });
}
