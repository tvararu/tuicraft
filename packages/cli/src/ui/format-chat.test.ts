import { describe, expect, test } from "bun:test";
import { type ChatMessage, ChatType } from "@tuicraft/core";
import { parseDarkwraithFrenzy } from "#test-support/monster-chat-fixtures";
import { formatMessage, formatMessageObj } from "#ui/format-chat";

function creature(type: number, message: string): ChatMessage {
  return { message, sender: "Darkwraith", type };
}

describe("creature chat", () => {
  test("a captured monster emote names its creature in both outputs", () => {
    const raw = parseDarkwraithFrenzy();
    expect(raw).toMatchObject({
      message: "%s goes into a frenzy!",
      senderName: "Darkwraith",
      type: ChatType.MONSTER_EMOTE,
    });
    const msg = { message: raw.message, sender: "Darkwraith", type: raw.type };
    expect(formatMessage(msg)).toBe(
      "[monster emote] Darkwraith goes into a frenzy!",
    );
    expect(formatMessageObj(msg)).toEqual({
      message: "Darkwraith goes into a frenzy!",
      sender: "Darkwraith",
      type: "MONSTER_EMOTE",
    });
  });

  test("monster speech keeps its speaker and gets a named type", () => {
    const cases = [
      [ChatType.MONSTER_SAY, "[monster say] Darkwraith: Die!", "MONSTER_SAY"],
      [
        ChatType.MONSTER_YELL,
        "[monster yell] Darkwraith: Die!",
        "MONSTER_YELL",
      ],
      [
        ChatType.MONSTER_WHISPER,
        "[monster whisper] Darkwraith: Die!",
        "MONSTER_WHISPER",
      ],
      [
        ChatType.RAID_BOSS_WHISPER,
        "[boss whisper] Darkwraith: Die!",
        "RAID_BOSS_WHISPER",
      ],
    ] as const;
    for (const [type, text, json] of cases) {
      expect(formatMessage(creature(type, "Die!"))).toBe(text);
      expect(formatMessageObj(creature(type, "Die!")).type).toBe(json);
    }
  });

  test("boss emotes substitute the name and player emotes are left alone", () => {
    expect(
      formatMessage(creature(ChatType.RAID_BOSS_EMOTE, "%s becomes enraged!")),
    ).toBe("[boss emote] Darkwraith becomes enraged!");
    expect(formatMessage(creature(ChatType.EMOTE, "waves at %s"))).toBe(
      "[emote] Darkwraith: waves at %s",
    );
  });
});
