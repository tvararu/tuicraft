import { describe, expect, type jest, test } from "bun:test";
import { PassThrough } from "node:stream";
import { createMockHandle } from "test/mock-handle";
import { flush, writeLine } from "test/tui-fixtures";
import { startTui } from "ui/tui";

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

  test("quit command logs out and resolves", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/quit");
    await done;

    expect(handle.logout).toHaveBeenCalled();
  });
});
