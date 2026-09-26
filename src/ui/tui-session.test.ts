import { describe, expect, jest, test } from "bun:test";
import { PassThrough } from "node:stream";
import { createMockHandle } from "test/mock-handle";
import { flush, writeLine } from "test/tui-fixtures";
import { startTui } from "ui/tui";
import { ChatType } from "wow";

describe("startTui", () => {
  test("incoming message writes formatted output", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    handle.triggerMessage({
      message: "hi",
      sender: "Alice",
      type: ChatType.SAY,
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
      message: "psst",
      sender: "Eve",
      type: ChatType.WHISPER,
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
        message: "hi",
        sender: "Al",
        type: ChatType.SAY,
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
        classId: 1,
        gender: 0,
        guild: "G",
        level: 80,
        name: "Test",
        race: 1,
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
        message: "hi",
        sender: "Alice",
        type: ChatType.SAY,
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
    writeLine(input, "/mail");
    await flush();

    expect(output.join("")).toContain("Mail reading is not yet implemented");

    input.end();
    await done;
  });

  test("/ginvite calls handle.guildInvite", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/ginvite Foo");
    await flush();

    expect(handle.guildInvite).toHaveBeenCalledWith("Foo");

    input.end();
    await done;
  });

  test("/join calls joinChannel", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/join Trade");
    await flush();

    expect(handle.joinChannel).toHaveBeenCalledWith("Trade", undefined);

    input.end();
    await done;
  });

  test("/leave with channel calls leaveChannel", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/leave Trade");
    await flush();

    expect(handle.leaveChannel).toHaveBeenCalledWith("Trade");

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
      name: "Voidtrix",
      type: "invite_declined",
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
      change: { added: [], formed: false, removed: [] },
      leader: "",
      loot: null,
      members: [],
      type: "group_list",
    });

    expect(output).toEqual([]);

    input.end();
    await done;
  });
});
