import type { Socket, TCPSocketListener } from "bun";
import { PacketReader, PacketWriter } from "protocol/packet";
import { AuthOpcode } from "protocol/opcodes";
import { bigIntToLeBytes } from "crypto/srp";
import {
  salt,
  g,
  N,
  B_LE,
  expectedA,
  expectedM1,
  M2_bytes,
} from "test/fixtures";

export function startMockAuthServer(opts: {
  realmAddress: string;
}): Promise<{ port: number; stop(): void }> {
  return new Promise((resolve) => {
    let listener: TCPSocketListener<undefined>;

    listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket: Socket, data: Uint8Array) {
          const opcode = data[0];

          if (opcode === AuthOpcode.LOGON_CHALLENGE) {
            const w = new PacketWriter();
            w.uint8(AuthOpcode.LOGON_CHALLENGE);
            w.uint8(0x00);
            w.uint8(0x00);
            w.rawBytes(B_LE);
            w.uint8(1);
            w.uint8(Number(g));
            w.uint8(32);
            w.rawBytes(bigIntToLeBytes(N, 32));
            w.rawBytes(salt);
            w.rawBytes(new Uint8Array(16));
            w.uint8(0x00);
            socket.write(w.finish());
          } else if (opcode === AuthOpcode.LOGON_PROOF) {
            const r = new PacketReader(data, 1);
            const A = r.bytes(32);
            const M1 = r.bytes(20);

            let match = true;
            for (let i = 0; i < 32; i++) {
              if (A[i] !== expectedA[i]) {
                match = false;
                break;
              }
            }
            for (let i = 0; i < 20; i++) {
              if (M1[i] !== expectedM1[i]) {
                match = false;
                break;
              }
            }

            const w = new PacketWriter();
            w.uint8(AuthOpcode.LOGON_PROOF);
            if (match) {
              w.uint8(0x00);
              w.rawBytes(M2_bytes);
              w.uint32LE(0x00800000);
              w.uint32LE(0);
              w.uint16LE(0);
            } else {
              w.uint8(0x05);
              w.rawBytes(new Uint8Array(2));
            }
            socket.write(w.finish());
          } else if (opcode === AuthOpcode.REALM_LIST) {
            const realm = new PacketWriter();
            realm.uint8(0x00);
            realm.uint8(0x00);
            realm.uint8(0x00);
            realm.cString("Test Realm");
            realm.cString(opts.realmAddress);
            realm.uint32LE(0);
            realm.uint8(1);
            realm.uint8(1);
            realm.uint8(1);
            const realmData = realm.finish();

            const w = new PacketWriter();
            w.uint8(AuthOpcode.REALM_LIST);
            w.uint16LE(realmData.byteLength + 8);
            w.uint32LE(0);
            w.uint16LE(1);
            w.rawBytes(realmData);
            w.uint16LE(0x0010);
            socket.write(w.finish());
          }
        },
        open() {},
        close() {},
        error() {},
      },
    });

    resolve({
      port: listener.port,
      stop() {
        listener.stop(true);
      },
    });
  });
}
