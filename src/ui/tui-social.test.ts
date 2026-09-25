import { describe, expect, type jest, test } from "bun:test";
import { PassThrough } from "node:stream";
import { createMockHandle } from "test/mock-handle";
import { flush, writeLine } from "test/tui-fixtures";
import { startTui } from "ui/tui";

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

describe("ignore TUI commands", () => {
  test("/ignore bare calls getIgnored and writes output", async () => {
    const handle = createMockHandle();
    (handle.getIgnored as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/ignore");
    await flush();

    expect(handle.getIgnored).toHaveBeenCalled();
    expect(output.join("")).toContain("Ignore list is empty");

    input.end();
    await done;
  });

  test("/ignorelist calls getIgnored and writes output", async () => {
    const handle = createMockHandle();
    (handle.getIgnored as ReturnType<typeof jest.fn>).mockReturnValue([]);
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/ignorelist");
    await flush();

    expect(handle.getIgnored).toHaveBeenCalled();
    expect(output.join("")).toContain("Ignore list is empty");

    input.end();
    await done;
  });

  test("/ignore name calls addIgnore", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/ignore Spammer");
    await flush();

    expect(handle.addIgnore).toHaveBeenCalledWith("Spammer");

    input.end();
    await done;
  });

  test("/unignore name calls removeIgnore", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/unignore Spammer");
    await flush();

    expect(handle.removeIgnore).toHaveBeenCalledWith("Spammer");

    input.end();
    await done;
  });
});

describe("guild TUI commands", () => {
  test("/groster with no roster shows unavailable message", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/groster");
    await flush(2);

    expect(handle.requestGuildRoster).toHaveBeenCalled();
    expect(output.join("")).toContain("No guild roster available");

    input.end();
    await done;
  });

  test("/groster with roster shows formatted output", async () => {
    const handle = createMockHandle();
    (handle.requestGuildRoster as ReturnType<typeof jest.fn>).mockResolvedValue(
      {
        guildInfo: "",
        guildName: "Horde Elite",
        members: [
          {
            area: 10,
            gender: 0,
            guid: 1n,
            level: 80,
            name: "Thrall",
            officerNote: "",
            playerClass: 7,
            publicNote: "",
            rankIndex: 0,
            status: 1,
            timeOffline: 0,
          },
        ],
        motd: "Welcome!",
        rankNames: ["GM"],
      },
    );
    const input = new PassThrough();
    const output: string[] = [];

    const done = startTui(handle, false, {
      input,
      write: (s) => void output.push(s),
    });
    writeLine(input, "/groster");
    await flush(2);

    expect(output.join("")).toContain("Horde Elite");
    expect(output.join("")).toContain("Thrall");

    input.end();
    await done;
  });

  test("/gkick calls handle.guildRemove", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/gkick Garrosh");
    await flush();

    expect(handle.guildRemove).toHaveBeenCalledWith("Garrosh");

    input.end();
    await done;
  });

  test("/gleave calls handle.guildLeave", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/gleave");
    await flush();

    expect(handle.guildLeave).toHaveBeenCalled();

    input.end();
    await done;
  });

  test("/gpromote calls handle.guildPromote", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/gpromote Jaina");
    await flush();

    expect(handle.guildPromote).toHaveBeenCalledWith("Jaina");

    input.end();
    await done;
  });

  test("/gdemote calls handle.guildDemote", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/gdemote Arthas");
    await flush();

    expect(handle.guildDemote).toHaveBeenCalledWith("Arthas");

    input.end();
    await done;
  });

  test("/gleader calls handle.guildLeader", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/gleader Sylvanas");
    await flush();

    expect(handle.guildLeader).toHaveBeenCalledWith("Sylvanas");

    input.end();
    await done;
  });

  test("/gmotd calls handle.guildMotd", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/gmotd Raid tonight at 8pm");
    await flush();

    expect(handle.guildMotd).toHaveBeenCalledWith("Raid tonight at 8pm");

    input.end();
    await done;
  });

  test("/gaccept calls handle.acceptGuildInvite", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/gaccept");
    await flush();

    expect(handle.acceptGuildInvite).toHaveBeenCalled();

    input.end();
    await done;
  });

  test("/gdecline calls handle.declineGuildInvite", async () => {
    const handle = createMockHandle();
    const input = new PassThrough();

    const done = startTui(handle, false, { input, write: () => {} });
    writeLine(input, "/gdecline");
    await flush();

    expect(handle.declineGuildInvite).toHaveBeenCalled();

    input.end();
    await done;
  });
});
