import { test, expect, describe, jest } from "bun:test";
import { PassThrough } from "node:stream";
import { startTui } from "ui/tui";
import { ChatType } from "wow/protocol/opcodes";
import { ObjectType } from "wow/protocol/entity-fields";
import { createMockHandle } from "test/mock-handle";

function writeLine(stream: PassThrough, line: string): void {
  stream.write(line + "\n");
}

const flush = async (turns = 1): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await Bun.sleep(0);
  }
};

describe("startTui", () => {
  test("bare text sends via sticky mode", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "hello");
    await flush();

    expect(handle.sendInCurrentMode).toHaveBeenCalledWith("hello");

    input.end();
    await done;
  });

  test("/say explicitly sends say and not sendInCurrentMode", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/say hello");
    await flush();

    expect(handle.sendSay).toHaveBeenCalledWith("hello");
    expect(handle.sendInCurrentMode).not.toHaveBeenCalled();

    input.end();
    await done;
  });

  test("dispatches yell, guild, party, raid, emote, dnd, afk commands", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/y LOUD");
    writeLine(input, "/g guild msg");
    writeLine(input, "/p party msg");
    writeLine(input, "/raid pull now");
    writeLine(input, "/e waves hello");
    writeLine(input, "/dnd busy");
    writeLine(input, "/afk coffee break");
    await flush();

    expect(handle.sendYell).toHaveBeenCalledWith("LOUD");
    expect(handle.sendGuild).toHaveBeenCalledWith("guild msg");
    expect(handle.sendParty).toHaveBeenCalledWith("party msg");
    expect(handle.sendRaid).toHaveBeenCalledWith("pull now");
    expect(handle.sendEmote).toHaveBeenCalledWith("waves hello");
    expect(handle.sendDnd).toHaveBeenCalledWith("busy");
    expect(handle.sendAfk).toHaveBeenCalledWith("coffee break");

    input.end();
    await done;
  });

  test("dispatches roll command", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/roll");
    writeLine(input, "/roll 50");
    writeLine(input, "/roll 10 20");
    await flush();

    expect(handle.sendRoll).toHaveBeenCalledWith(1, 100);
    expect(handle.sendRoll).toHaveBeenCalledWith(1, 50);
    expect(handle.sendRoll).toHaveBeenCalledWith(10, 20);

    input.end();
    await done;
  });

  test("dispatches whisper command", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/w Alice hey there");
    await flush();

    expect(handle.sendWhisper).toHaveBeenCalledWith("Alice", "hey there");

    input.end();
    await done;
  });

  test("reply without prior whisper shows error", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/r hello");
    await flush();

    expect(output.join("")).toContain("No one has whispered you yet");

    input.end();
    await done;
  });

  test("reply after whisper sends to last sender", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/w Bob initial");
    writeLine(input, "/r followup");
    await flush();

    expect(handle.sendWhisper).toHaveBeenCalledWith("Bob", "followup");

    input.end();
    await done;
  });

  test("who command formats results", async () => {
    const handle = createMockHandle();
    (handle.who as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        name: "Test",
        guild: "G",
        level: 80,
        classId: 1,
        race: 1,
        gender: 0,
        zone: 1,
      },
    ]);
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/who");
    await flush(2);

    expect(output.join("")).toContain("[who] 1 results: Test (80)");

    input.end();
    await done;
  });

  test("channel by number resolves via getChannel", async () => {
    const handle = createMockHandle();
    (handle.getChannel as ReturnType<typeof jest.fn>).mockReturnValue(
      "General",
    );
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/1 hello general");
    await flush();

    expect(handle.getChannel).toHaveBeenCalledWith(1);
    expect(handle.sendChannel).toHaveBeenCalledWith("General", "hello general");

    input.end();
    await done;
  });

  test("channel by number not joined shows error", async () => {
    const handle = createMockHandle();
    (handle.getChannel as ReturnType<typeof jest.fn>).mockReturnValue(
      undefined,
    );
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/3 hello");
    await flush();

    expect(output.join("")).toContain("Not in channel 3");

    input.end();
    await done;
  });

  test("quit command closes handle and resolves", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/quit");
    await done;

    expect(handle.close).toHaveBeenCalled();
  });

  test("incoming message writes formatted output", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    handle.triggerMessage({
      type: ChatType.SAY,
      sender: "Alice",
      message: "hi",
    });

    expect(output.join("")).toContain("[say] Alice: hi");

    input.end();
    await done;
  });

  test("incoming whisper sets lastWhisperFrom for reply", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    handle.triggerMessage({
      type: ChatType.WHISPER,
      sender: "Eve",
      message: "psst",
    });

    writeLine(input, "/r got it");
    await flush();

    expect(handle.sendWhisper).toHaveBeenCalledWith("Eve", "got it");

    input.end();
    await done;
  });

  test("SIGINT closes handle and resolves", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const spy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const done = startTui(handle, true, {
        input,
        write: () => {},
      });
      input.write("\x03");
      await done;

      expect(handle.close).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("stream close resolves promise", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    input.end();
    await done;
  });

  test("server disconnect closes readline", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    handle.resolveClosed();
    await done;
  });

  test("defaults to process.stdout.write when no write option", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const spy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const done = startTui(handle, false, { input });
      handle.triggerMessage({
        type: ChatType.SAY,
        sender: "Al",
        message: "hi",
      });

      expect(spy).toHaveBeenCalled();
      input.end();
      await done;
    } finally {
      spy.mockRestore();
    }
  });

  test("interactive who formats results inline", async () => {
    const handle = createMockHandle();
    (handle.who as ReturnType<typeof jest.fn>).mockResolvedValue([
      {
        name: "Test",
        guild: "G",
        level: 80,
        classId: 1,
        race: 1,
        gender: 0,
        zone: 1,
      },
    ]);
    const input = new PassThrough();
    const output: string[] = [];
    const spy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const done = startTui(handle, true, {
        input,
        write: (s) => void output.push(s),
      });
      writeLine(input, "/who");
      await flush(2);

      expect(output.join("")).toContain("[who] 1 results: Test (80)");

      input.end();
      await done;
    } finally {
      spy.mockRestore();
    }
  });

  test("interactive mode uses ANSI formatting", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];
    const spy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const done = startTui(handle, true, {
        input,
        write: (s) => void output.push(s),
      });
      handle.triggerMessage({
        type: ChatType.SAY,
        sender: "Alice",
        message: "hi",
      });

      expect(output.join("")).toContain("\r\x1b[K[say] Alice: hi\n");

      input.end();
      await done;
    } finally {
      spy.mockRestore();
    }
  });

  test("command error is caught and displayed", async () => {
    const handle = createMockHandle();
    (handle.who as ReturnType<typeof jest.fn>).mockRejectedValue(
      new Error("Timed out waiting for opcode 0x63"),
    );
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/who");
    await flush(2);

    expect(output.join("")).toContain("Timed out waiting for opcode 0x63");

    input.end();
    await done;
  });

  test("/invite calls handle.invite", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/invite Voidtrix");
    await flush();

    expect(handle.invite).toHaveBeenCalledWith("Voidtrix");

    input.end();
    await done;
  });

  test("/kick calls handle.uninvite", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/kick Voidtrix");
    await flush();

    expect(handle.uninvite).toHaveBeenCalledWith("Voidtrix");

    input.end();
    await done;
  });

  test("/leave calls handle.leaveGroup", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/leave");
    await flush();

    expect(handle.leaveGroup).toHaveBeenCalled();

    input.end();
    await done;
  });

  test("/leader calls handle.setLeader", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/leader Voidtrix");
    await flush();

    expect(handle.setLeader).toHaveBeenCalledWith("Voidtrix");

    input.end();
    await done;
  });

  test("/accept calls handle.acceptInvite", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/accept");
    await flush();

    expect(handle.acceptInvite).toHaveBeenCalled();

    input.end();
    await done;
  });

  test("/decline calls handle.declineInvite", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/decline");
    await flush();

    expect(handle.declineInvite).toHaveBeenCalled();

    input.end();
    await done;
  });

  test("unimplemented command writes error message", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/ignore");
    await flush();

    expect(output.join("")).toContain("Ignore list is not yet implemented");

    input.end();
    await done;
  });

  test("incoming displayable group event writes output", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    handle.triggerGroupEvent({
      type: "invite_declined",
      name: "Voidtrix",
    });

    expect(output.join("")).toContain(
      "[group] Voidtrix has declined your invitation",
    );

    input.end();
    await done;
  });

  test("incoming non-displayable group event is ignored", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    handle.triggerGroupEvent({
      type: "group_list",
      members: [],
      leader: "",
    });

    expect(output).toEqual([]);

    input.end();
    await done;
  });
});

describe("tuicraft command", () => {
  test("entities on enables display", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/tuicraft entities on");
    await flush();

    expect(output.join("")).toContain("Entity events enabled");

    input.end();
    await done;
  });

  test("entities with invalid value shows usage", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/tuicraft entities toggle");
    await flush();

    expect(output.join("")).toContain("Usage: /tuicraft entities on|off");

    input.end();
    await done;
  });

  test("entities off disables display", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/tuicraft entities off");
    await flush();

    expect(output.join("")).toContain("Entity events disabled");

    input.end();
    await done;
  });

  test("unknown subcommand shows error", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/tuicraft foo");
    await flush();

    expect(output.join("")).toContain("Unknown tuicraft command: foo");

    input.end();
    await done;
  });

  test("entity events displayed when enabled", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/tuicraft entities on");
    await flush();

    handle.triggerEntityEvent({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Innkeeper Palla",
        level: 55,
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        health: 100,
        maxHealth: 100,
        factionTemplate: 0,
        displayId: 0,
        npcFlags: 0,
        unitFlags: 0,
        target: 0n,
        race: 0,
        class_: 0,
        gender: 0,
        power: [],
        maxPower: [],
      },
    });

    expect(output.join("")).toContain(
      "[world] Innkeeper Palla appeared (NPC, level 55)",
    );

    input.end();
    await done;
  });

  test("entity events suppressed when disabled", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });

    handle.triggerEntityEvent({
      type: "appear",
      entity: {
        guid: 1n,
        objectType: ObjectType.UNIT,
        name: "Innkeeper Palla",
        level: 55,
        entry: 0,
        scale: 1,
        position: undefined,
        rawFields: new Map(),
        health: 100,
        maxHealth: 100,
        factionTemplate: 0,
        displayId: 0,
        npcFlags: 0,
        unitFlags: 0,
        target: 0n,
        race: 0,
        class_: 0,
        gender: 0,
        power: [],
        maxPower: [],
      },
    });

    expect(output.join("")).not.toContain("[world]");

    input.end();
    await done;
  });
});

describe("friend TUI commands", () => {
  test("/friends calls getFriends and writes output", async () => {
    const handle = createMockHandle();
    (handle.getFriends as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/friends");
    await flush();

    expect(handle.getFriends).toHaveBeenCalled();
    expect(output.join("")).toContain("No friends on your list");

    input.end();
    await done;
  });

  test("/friend add calls addFriend", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/friend add Arthas");
    await flush();

    expect(handle.addFriend).toHaveBeenCalledWith("Arthas");

    input.end();
    await done;
  });

  test("/friend remove calls removeFriend", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/friend remove Arthas");
    await flush();

    expect(handle.removeFriend).toHaveBeenCalledWith("Arthas");

    input.end();
    await done;
  });
});
