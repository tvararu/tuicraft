import { describe, expect, test } from "bun:test";
import {
  formatGuildCommandError,
  GuildCommand,
  GuildCommandResult,
  parseGuildCommandResult,
  parseGuildInvitePacket,
} from "wow/protocol/guild";
import { PacketReader, PacketWriter } from "wow/protocol/packet";

describe("GuildCommand", () => {
  test("INVITE is 1", () => {
    expect(GuildCommand.INVITE).toBe(1);
  });

  test("QUIT is 2", () => {
    expect(GuildCommand.QUIT).toBe(2);
  });

  test("PROMOTE is 3", () => {
    expect(GuildCommand.PROMOTE).toBe(3);
  });

  test("FOUNDER is 0x0C", () => {
    expect(GuildCommand.FOUNDER).toBe(0x0c);
  });
});

describe("GuildCommandResult", () => {
  test("PLAYER_NO_MORE_IN_GUILD is 0", () => {
    expect(GuildCommandResult.PLAYER_NO_MORE_IN_GUILD).toBe(0);
  });

  test("PLAYER_NOT_FOUND_S is 0x0B", () => {
    expect(GuildCommandResult.GUILD_PLAYER_NOT_FOUND_S).toBe(0x0b);
  });

  test("GUILD_LEADER_LEAVE_OR_PERMISSIONS is 0x08", () => {
    expect(GuildCommandResult.GUILD_LEADER_LEAVE_OR_PERMISSIONS).toBe(0x08);
  });
});

describe("parseGuildCommandResult", () => {
  test("parses command, name, and result", () => {
    const w = new PacketWriter();
    w.uint32LE(GuildCommand.INVITE);
    w.cString("Thrall");
    w.uint32LE(GuildCommandResult.ALREADY_IN_GUILD_S);
    const result = parseGuildCommandResult(new PacketReader(w.finish()));
    expect(result).toEqual({
      command: GuildCommand.INVITE,
      name: "Thrall",
      result: GuildCommandResult.ALREADY_IN_GUILD_S,
    });
  });

  test("parses result with empty name", () => {
    const w = new PacketWriter();
    w.uint32LE(GuildCommand.QUIT);
    w.cString("");
    w.uint32LE(GuildCommandResult.GUILD_LEADER_LEAVE_OR_PERMISSIONS);
    const result = parseGuildCommandResult(new PacketReader(w.finish()));
    expect(result.command).toBe(GuildCommand.QUIT);
    expect(result.name).toBe("");
    expect(result.result).toBe(
      GuildCommandResult.GUILD_LEADER_LEAVE_OR_PERMISSIONS,
    );
  });

  test("consumes all bytes", () => {
    const w = new PacketWriter();
    w.uint32LE(0);
    w.cString("X");
    w.uint32LE(0);
    const r = new PacketReader(w.finish());
    parseGuildCommandResult(r);
    expect(r.remaining).toBe(0);
  });
});

describe("parseGuildInvitePacket", () => {
  test("parses inviter name and guild name", () => {
    const w = new PacketWriter();
    w.cString("Thrall");
    w.cString("Horde Heroes");
    const result = parseGuildInvitePacket(new PacketReader(w.finish()));
    expect(result).toEqual({
      inviterName: "Thrall",
      guildName: "Horde Heroes",
    });
  });

  test("consumes all bytes", () => {
    const w = new PacketWriter();
    w.cString("A");
    w.cString("B");
    const r = new PacketReader(w.finish());
    parseGuildInvitePacket(r);
    expect(r.remaining).toBe(0);
  });
});

describe("formatGuildCommandError", () => {
  test("returns undefined for success (PLAYER_NO_MORE_IN_GUILD)", () => {
    expect(
      formatGuildCommandError(GuildCommand.INVITE, "Thrall", 0x00),
    ).toBeUndefined();
  });

  test("returns internal error", () => {
    expect(formatGuildCommandError(0, "", 0x01)).toBe(
      "[guild] Internal guild error",
    );
  });

  test("returns already in guild (no name)", () => {
    expect(formatGuildCommandError(0, "", 0x02)).toBe(
      "[guild] You are already in a guild",
    );
  });

  test("returns already in guild with name", () => {
    expect(formatGuildCommandError(GuildCommand.INVITE, "Thrall", 0x03)).toBe(
      "[guild] Thrall is already in a guild",
    );
  });

  test("returns already invited", () => {
    expect(formatGuildCommandError(0, "", 0x04)).toBe(
      "[guild] You have already been invited to a guild",
    );
  });

  test("returns already invited with name", () => {
    expect(formatGuildCommandError(0, "Jaina", 0x05)).toBe(
      "[guild] Jaina has already been invited to a guild",
    );
  });

  test("returns invalid guild name", () => {
    expect(formatGuildCommandError(0, "", 0x06)).toBe(
      "[guild] Invalid guild name",
    );
  });

  test("returns guild name exists", () => {
    expect(formatGuildCommandError(0, "Horde", 0x07)).toBe(
      '[guild] Guild name "Horde" already exists',
    );
  });

  test("returns permission denied", () => {
    expect(formatGuildCommandError(0, "", 0x08)).toBe(
      "[guild] You don't have permission to do that",
    );
  });

  test("returns not in guild (self)", () => {
    expect(formatGuildCommandError(0, "", 0x09)).toBe(
      "[guild] You are not in a guild",
    );
  });

  test("returns player not in guild with name", () => {
    expect(formatGuildCommandError(0, "Garrosh", 0x0a)).toBe(
      "[guild] Garrosh is not in your guild",
    );
  });

  test("returns player not found", () => {
    expect(formatGuildCommandError(0, "Nobody", 0x0b)).toBe(
      '[guild] Player "Nobody" not found',
    );
  });

  test("returns not allied", () => {
    expect(formatGuildCommandError(0, "Alliance", 0x0c)).toBe(
      "[guild] Alliance is not the same alliance as you",
    );
  });

  test("returns rank too high", () => {
    expect(formatGuildCommandError(0, "Officer", 0x0d)).toBe(
      "[guild] Officer has a rank too high for that",
    );
  });

  test("returns rank too low", () => {
    expect(formatGuildCommandError(0, "Recruit", 0x0e)).toBe(
      "[guild] Recruit has a rank too low for that",
    );
  });

  test("returns ranks locked", () => {
    expect(formatGuildCommandError(0, "", 0x11)).toBe(
      "[guild] Guild ranks are locked",
    );
  });

  test("returns rank in use", () => {
    expect(formatGuildCommandError(0, "", 0x12)).toBe(
      "[guild] That guild rank is in use",
    );
  });

  test("returns ignoring you", () => {
    expect(formatGuildCommandError(0, "Snob", 0x13)).toBe(
      "[guild] Snob is ignoring you",
    );
  });

  test("returns generic error for unknown result code", () => {
    expect(formatGuildCommandError(0, "", 0xff)).toBe(
      "[guild] Guild command error (255)",
    );
  });
});
