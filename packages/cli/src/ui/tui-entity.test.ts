import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { createMockHandle } from "@tuicraft/core/test-support/mock-handle";
import { makeUnitEntity } from "#test-support/format-fixtures";
import { flush, writeLine } from "#test-support/tui-fixtures";
import { startTui } from "#ui/tui";

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
      entity: makeUnitEntity(),
      type: "appear",
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
      entity: makeUnitEntity(),
      type: "appear",
    });

    expect(output.join("")).not.toContain("[world]");

    input.end();
    await done;
  });
});
