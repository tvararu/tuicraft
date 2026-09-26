import { describe, expect, test } from "bun:test";
import { captured8325, ERONA_GUID } from "test/quest-8325-packets";
import { questCapture } from "test/quest-capture-fixtures";
import { GameOpcode } from "wow/protocol/opcodes";

const setup = () => questCapture(0x9fbn);

const capturedCancel = {
  close: "",
  talk: "804900ae3b0030f1",
};

describe("cancelling an unanswered quest request", () => {
  test("a talk ignored at range stays unresolved through two live cancels", () => {
    const { bodies, packet, runtime, sent } = setup();
    runtime.talk(ERONA_GUID);
    runtime.cancel();
    expect(() => runtime.talk(ERONA_GUID)).toThrow("quest_reply_unanswered");
    packet(GameOpcode.SMSG_GOSSIP_COMPLETE, capturedCancel.close);
    runtime.cancel();
    packet(GameOpcode.SMSG_GOSSIP_COMPLETE, capturedCancel.close);
    expect(sent).toEqual([
      GameOpcode.CMSG_GOSSIP_HELLO,
      GameOpcode.CMSG_QUESTGIVER_CANCEL,
      GameOpcode.CMSG_QUESTGIVER_CANCEL,
    ]);
    expect(bodies).toEqual([capturedCancel.talk, "", ""]);
    expect(runtime.snapshot().pending).toBeUndefined();
    expect(runtime.snapshot().unresolved).toEqual([
      { action: "talk", at: 1000, guid: ERONA_GUID },
    ]);
  });

  test("a second cancelled request does not replace the first", () => {
    const { packet, runtime } = setup();
    runtime.talk(ERONA_GUID);
    runtime.cancel();
    packet(GameOpcode.SMSG_GOSSIP_COMPLETE, "");
    runtime.talk(3n);
    runtime.cancel();
    packet(GameOpcode.SMSG_GOSSIP_COMPLETE, "");
    expect(runtime.snapshot().unresolved.map((intent) => intent.guid)).toEqual([
      ERONA_GUID,
      3n,
    ]);
  });

  test("only the quest log resolves a cancelled acceptance", () => {
    const { logQuest, packet, runtime } = setup();
    runtime.talk(ERONA_GUID);
    packet(GameOpcode.SMSG_GOSSIP_MESSAGE, captured8325.offerMenu);
    runtime.selectQuest(8325);
    packet(GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS, captured8325.details);
    runtime.accept();
    runtime.cancel();
    packet(GameOpcode.SMSG_GOSSIP_COMPLETE, "");
    expect(runtime.snapshot().unresolved).toMatchObject([
      { action: "accept", questId: 8325 },
    ]);
    logQuest(8325, 0);
    expect(runtime.snapshot().unresolved).toEqual([]);
  });
});
