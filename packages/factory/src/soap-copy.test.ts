import { describe, expect, test } from "bun:test";
import {
  type CopyTiming,
  copyConfirmed,
  type SoapResult,
} from "#factory/soap-copy";

const names = { account: "FAC6AB6E05F5A", character: "Fgklgoafpfk" };
const timing: CopyTiming = {
  attempts: 3,
  pollMs: 1,
  sleep: async () => {},
  tries: 2,
};
const present: SoapResult = {
  ok: true,
  text: "Player Fgklgoafpfk (offline)\nAccount: FAC6AB6E05F5A (ID: 12)",
};
const missing: SoapResult = {
  ok: false,
  text: "Character 'Fgklgoafpfk' does not exist.",
};
const copied: SoapResult = { ok: true, text: "Character copied." };

function script(replies: Record<string, SoapResult[]>) {
  const calls: string[] = [];
  const run = async (command: string): Promise<SoapResult> => {
    calls.push(command);
    const verb = command.split(" ").slice(0, 2).join(" ");
    const queue = replies[verb] ?? [];
    return queue.length > 1
      ? (queue.shift() as SoapResult)
      : (queue[0] ?? missing);
  };
  return { calls, run };
}

const copyCalls = (calls: string[]) =>
  calls.filter((c) => c.startsWith("pdump copy")).length;

describe("copyConfirmed", () => {
  test("one copy when pinfo shows the character", async () => {
    const { calls, run } = script({
      "pdump copy": [copied],
      "pinfo Fgklgoafpfk": [present],
    });
    expect(await copyConfirmed(run, "Tplhunter", names, timing)).toBe(1);
    expect(calls).toEqual([
      "pdump copy Tplhunter FAC6AB6E05F5A Fgklgoafpfk",
      "pinfo Fgklgoafpfk",
    ]);
  });

  test("copies again when pdump reports success but no character exists", async () => {
    const { calls, run } = script({
      "pdump copy": [copied],
      "pinfo Fgklgoafpfk": [missing, missing, present],
    });
    expect(await copyConfirmed(run, "Tplhunter", names, timing)).toBe(2);
    expect(copyCalls(calls)).toBe(2);
  });

  test("fails clearly after three silent failures", async () => {
    const { calls, run } = script({
      "pdump copy": [copied],
      "pinfo Fgklgoafpfk": [missing],
    });
    await expect(
      copyConfirmed(run, "Tplhunter", names, timing),
    ).rejects.toThrow(
      "pdump copy Tplhunter: Fgklgoafpfk missing on FAC6AB6E05F5A after 3 attempts",
    );
    expect(copyCalls(calls)).toBe(3);
  });

  test("waits for a new account to become visible to pdump", async () => {
    const { calls, run } = script({
      "pdump copy": [
        { ok: false, text: "Account 'FAC6AB6E05F5A' does not exist." },
        copied,
      ],
      "pinfo Fgklgoafpfk": [present],
    });
    expect(await copyConfirmed(run, "Tplhunter", names, timing)).toBe(1);
    expect(copyCalls(calls)).toBe(2);
  });

  test("a pdump error other than a missing account is fatal", async () => {
    const { run } = script({
      "pdump copy": [{ ok: false, text: "Invalid character name" }],
    });
    await expect(
      copyConfirmed(run, "Tplhunter", names, timing),
    ).rejects.toThrow("pdump copy: Invalid character name");
  });

  test("a character owned by another account is fatal", async () => {
    const { calls, run } = script({
      "pdump copy": [copied],
      "pinfo Fgklgoafpfk": [
        { ok: true, text: "Account: FAC0000000000 (ID: 3)" },
      ],
    });
    await expect(
      copyConfirmed(run, "Tplhunter", names, timing),
    ).rejects.toThrow("names account FAC0000000000");
    expect(copyCalls(calls)).toBe(1);
  });
});
