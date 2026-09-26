import { describe, expect, test } from "bun:test";
import type { GuildEvent, WorldConn } from "wow/client";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import { createWorldEvents } from "wow/world-events";
import {
  handleGuildCommandResult,
  handleGuildEvent,
  handleGuildInvitePacket,
} from "wow/world-handlers-guild";

function connWith(listener?: (event: GuildEvent) => void): WorldConn {
  const events = createWorldEvents();
  if (listener) events.guild.subscribe(listener);
  return { events } as unknown as WorldConn;
}

describe("handleGuildEvent unit", () => {
  function fireEvent(
    eventType: number,
    params: string[],
    guid?: bigint,
  ): GuildEvent {
    const w = new PacketWriter();
    w.uint8(eventType);
    w.uint8(params.length);
    for (const p of params) w.cString(p);
    if (guid !== undefined) w.uint64LE(guid);
    let result!: GuildEvent;
    const conn = connWith((e: GuildEvent) => {
      result = e;
    });
    handleGuildEvent(conn, new PacketReader(w.finish()));
    return result;
  }

  test("demotion", () => {
    const e = fireEvent(1, ["Thrall", "Garrosh", "Member"]);
    expect(e).toEqual({
      type: "demotion",
      officer: "Thrall",
      member: "Garrosh",
      rank: "Member",
    });
  });

  test("motd", () => {
    const e = fireEvent(2, ["Raid tonight!"]);
    expect(e).toEqual({ type: "motd", text: "Raid tonight!" });
  });

  test("joined", () => {
    const e = fireEvent(3, ["Arthas"], 99n);
    expect(e).toEqual({ type: "joined", name: "Arthas" });
  });

  test("left", () => {
    const e = fireEvent(4, ["Sylvanas"], 7n);
    expect(e).toEqual({ type: "left", name: "Sylvanas" });
  });

  test("removed", () => {
    const e = fireEvent(5, ["Garrosh", "Thrall"]);
    expect(e).toEqual({
      type: "removed",
      member: "Garrosh",
      officer: "Thrall",
    });
  });

  test("leader_is", () => {
    const e = fireEvent(6, ["Thrall"]);
    expect(e).toEqual({ type: "leader_is", name: "Thrall" });
  });

  test("leader_changed", () => {
    const e = fireEvent(7, ["Thrall", "Garrosh"]);
    expect(e).toEqual({
      type: "leader_changed",
      oldLeader: "Thrall",
      newLeader: "Garrosh",
    });
  });

  test("disbanded", () => {
    const e = fireEvent(8, []);
    expect(e).toEqual({ type: "disbanded" });
  });

  test("signed_off", () => {
    const e = fireEvent(13, ["Varian"], 55n);
    expect(e).toEqual({ type: "signed_off", name: "Varian" });
  });
});

describe("handleGuildCommandResult", () => {
  test("fires command_result event for error", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.cString("Thrall");
    w.uint32LE(0x03);
    let result!: GuildEvent;
    const conn = connWith((e: GuildEvent) => {
      result = e;
    });
    handleGuildCommandResult(conn, new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "command_result",
      command: 1,
      name: "Thrall",
      result: 0x03,
    });
  });

  test("suppresses success result (code 0)", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.cString("Thrall");
    w.uint32LE(0x00);
    let called = false;
    const conn = connWith(() => {
      called = true;
    });
    handleGuildCommandResult(conn, new PacketReader(w.finish()));
    expect(called).toBe(false);
  });

  test("works without a guild listener", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.cString("X");
    w.uint32LE(0x0b);
    const conn = connWith();
    expect(() =>
      handleGuildCommandResult(conn, new PacketReader(w.finish())),
    ).not.toThrow();
  });
});

describe("handleGuildInvitePacket", () => {
  test("fires guild_invite event", () => {
    const w = new PacketWriter();
    w.cString("Thrall");
    w.cString("Horde Heroes");
    let result!: GuildEvent;
    const conn = connWith((e: GuildEvent) => {
      result = e;
    });
    handleGuildInvitePacket(conn, new PacketReader(w.finish()));
    expect(result).toEqual({
      type: "guild_invite",
      inviter: "Thrall",
      guildName: "Horde Heroes",
    });
  });

  test("works without a guild listener", () => {
    const w = new PacketWriter();
    w.cString("A");
    w.cString("B");
    const conn = connWith();
    expect(() =>
      handleGuildInvitePacket(conn, new PacketReader(w.finish())),
    ).not.toThrow();
  });
});
