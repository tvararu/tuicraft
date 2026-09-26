import { describe, expect, test } from "bun:test";
import { parseIpcCommand } from "daemon/parse";

describe("parseIpcCommand", () => {
  test("READ", () => {
    expect(parseIpcCommand("READ")).toEqual({ type: "read" });
  });

  test("READ_WAIT", () => {
    expect(parseIpcCommand("READ_WAIT 3000")).toEqual({
      ms: 3000,
      type: "read_wait",
    });
  });

  test("STOP", () => {
    expect(parseIpcCommand("STOP")).toEqual({ type: "stop" });
  });

  test("STATUS", () => {
    expect(parseIpcCommand("STATUS")).toEqual({ type: "status" });
  });

  test("WHO without filter", () => {
    expect(parseIpcCommand("WHO")).toEqual({ type: "who" });
  });

  test("WHO with filter", () => {
    expect(parseIpcCommand("WHO mage")).toEqual({
      filter: "mage",
      type: "who",
    });
  });

  test("READ_JSON", () => {
    expect(parseIpcCommand("READ_JSON")).toEqual({ type: "read_json" });
  });

  test("READ_WAIT_JSON", () => {
    expect(parseIpcCommand("READ_WAIT_JSON 2000")).toEqual({
      ms: 2000,
      type: "read_wait_json",
    });
  });

  test("TAIL_WAIT and TAIL_WAIT_JSON", () => {
    expect(parseIpcCommand("TAIL_WAIT 1000")).toEqual({
      ms: 1000,
      type: "tail_wait",
    });
    expect(parseIpcCommand("TAIL_WAIT_JSON 1000")).toEqual({
      ms: 1000,
      type: "tail_wait_json",
    });
  });

  test("EVENT_MARK and READ_WAIT since a mark", () => {
    expect(parseIpcCommand("EVENT_MARK")).toEqual({ type: "event_mark" });
    expect(parseIpcCommand("READ_WAIT_JSON 2000 17")).toEqual({
      ms: 2000,
      since: 17,
      type: "read_wait_json",
    });
    expect(parseIpcCommand("READ_WAIT 2000 x")).toBeUndefined();
    expect(parseIpcCommand("READ_WAIT 2000 1 2")).toBeUndefined();
    expect(parseIpcCommand("TAIL_WAIT 1000 3")).toBeUndefined();
  });

  test("WHO_JSON without filter", () => {
    expect(parseIpcCommand("WHO_JSON")).toEqual({ type: "who_json" });
  });

  test("WHO_JSON with filter", () => {
    expect(parseIpcCommand("WHO_JSON mage")).toEqual({
      filter: "mage",
      type: "who_json",
    });
  });
});
