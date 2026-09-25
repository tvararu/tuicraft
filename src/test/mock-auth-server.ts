import { createHash } from "node:crypto";
import type { Socket, TCPSocketListener } from "bun";
import {
  B_LE,
  expectedA,
  expectedM1,
  g,
  M2_bytes,
  N,
  salt,
} from "test/fixtures";
import { must } from "test/must";
import { bigIntToLeBytes } from "wow/crypto/srp";
import { AuthOpcode } from "wow/protocol/opcodes";
import { PacketReader, PacketWriter } from "wow/protocol/packet";

function handleChallenge(socket: Socket) {
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
}

function handleProof(socket: Socket, data: Uint8Array) {
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
    w.uint32LE(0x00_80_00_00);
    w.uint32LE(0);
    w.uint16LE(0);
  } else {
    w.uint8(0x05);
    w.rawBytes(new Uint8Array(2));
  }
  socket.write(w.finish());
}

function handleRealmList(socket: Socket, realmAddress: string) {
  const realm = new PacketWriter();
  realm.uint8(0x00);
  realm.uint8(0x00);
  realm.uint8(0x00);
  realm.cString("Test Realm");
  realm.cString(realmAddress);
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
  w.uint16LE(0x00_10);
  socket.write(w.finish());
}

function handleReconnectChallenge(socket: Socket, challengeData: Uint8Array) {
  const w = new PacketWriter();
  w.uint8(AuthOpcode.RECONNECT_CHALLENGE);
  w.uint8(0x00);
  w.rawBytes(challengeData);
  w.rawBytes(new Uint8Array(16));
  socket.write(w.finish());
}

type ReconnectConfig = { challengeData: Uint8Array; sessionKey: Uint8Array };

function handleReconnectProof(
  socket: Socket,
  data: Uint8Array,
  reconnect: ReconnectConfig,
  account: string,
) {
  const { challengeData, sessionKey: expectedSessionKey } = reconnect;
  const clientData = data.slice(1, 17);
  const receivedProof = data.slice(17, 37);

  const expectedProof = createHash("sha1")
    .update(new TextEncoder().encode(account))
    .update(challengeData)
    .update(clientData)
    .update(expectedSessionKey)
    .digest();

  const w = new PacketWriter();
  w.uint8(AuthOpcode.RECONNECT_PROOF);
  const match = Buffer.compare(Buffer.from(receivedProof), expectedProof) === 0;
  w.uint8(match ? 0x00 : 0x0b);
  socket.write(w.finish());
}

export function startMockAuthServer(opts: {
  realmAddress: string;
  reconnect?: ReconnectConfig;
}): Promise<{ port: number; stop(): void }> {
  return new Promise((resolve) => {
    let listener: TCPSocketListener<undefined>;

    listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        close() {},
        data(socket: Socket, data: Uint8Array) {
          const opcode = data[0];
          if (opcode === AuthOpcode.LOGON_CHALLENGE) {
            if (opts.reconnect) {
              handleReconnectChallenge(socket, opts.reconnect.challengeData);
            } else {
              handleChallenge(socket);
            }
          } else if (opcode === AuthOpcode.LOGON_PROOF) {
            handleProof(socket, data);
          } else if (opcode === AuthOpcode.RECONNECT_PROOF) {
            handleReconnectProof(
              socket,
              data,
              must(opts.reconnect, "reconnect config"),
              "TEST",
            );
          } else if (opcode === AuthOpcode.REALM_LIST) {
            handleRealmList(socket, opts.realmAddress);
          }
        },
        open() {},
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
