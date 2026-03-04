import { test, expect, describe } from "bun:test";
import { PacketReader, PacketWriter } from "wow/protocol/packet";
import {
  MailMessageType,
  MailCheckMask,
  MailAction,
  MailResult,
  parseShowMailbox,
  parseMailListResult,
  parseSendMailResult,
  buildGetMailList,
  buildSendMail,
  buildMailDelete,
  buildMailMarkAsRead,
  formatMailResultError,
} from "wow/protocol/mail";

describe("parseShowMailbox", () => {
  test("reads mailbox guid", () => {
    const w = new PacketWriter();
    w.uint64LE(0x1234n);
    const result = parseShowMailbox(new PacketReader(w.finish()));
    expect(result).toBe(0x1234n);
  });

  test("consumes all bytes", () => {
    const w = new PacketWriter();
    w.uint64LE(99n);
    const r = new PacketReader(w.finish());
    parseShowMailbox(r);
    expect(r.remaining).toBe(0);
  });
});

describe("buildGetMailList", () => {
  test("writes mailbox guid as u64 LE", () => {
    const body = buildGetMailList(0xabcdn);
    const r = new PacketReader(body);
    expect(r.uint64LE()).toBe(0xabcdn);
    expect(r.remaining).toBe(0);
  });
});

describe("buildSendMail", () => {
  test("writes all fields in order", () => {
    const body = buildSendMail(100n, "Thrall", "Hello", "How are you?");
    const r = new PacketReader(body);
    expect(r.uint64LE()).toBe(100n);
    expect(r.cString()).toBe("Thrall");
    expect(r.cString()).toBe("Hello");
    expect(r.cString()).toBe("How are you?");
    expect(r.uint32LE()).toBe(0);
    expect(r.uint32LE()).toBe(0);
    expect(r.uint8()).toBe(0);
    expect(r.uint32LE()).toBe(0);
    expect(r.uint32LE()).toBe(0);
    expect(r.uint32LE()).toBe(0);
    expect(r.uint32LE()).toBe(0);
    expect(r.remaining).toBe(0);
  });

  test("handles empty subject and body", () => {
    const body = buildSendMail(1n, "Jaina", "", "");
    const r = new PacketReader(body);
    r.uint64LE();
    expect(r.cString()).toBe("Jaina");
    expect(r.cString()).toBe("");
    expect(r.cString()).toBe("");
  });
});

describe("buildMailDelete", () => {
  test("writes mailbox guid, mail id, and template id 0", () => {
    const body = buildMailDelete(50n, 42);
    const r = new PacketReader(body);
    expect(r.uint64LE()).toBe(50n);
    expect(r.uint32LE()).toBe(42);
    expect(r.uint32LE()).toBe(0);
    expect(r.remaining).toBe(0);
  });
});

describe("buildMailMarkAsRead", () => {
  test("writes mailbox guid and mail id", () => {
    const body = buildMailMarkAsRead(50n, 7);
    const r = new PacketReader(body);
    expect(r.uint64LE()).toBe(50n);
    expect(r.uint32LE()).toBe(7);
    expect(r.remaining).toBe(0);
  });
});

function writeMailEntry(
  w: PacketWriter,
  opts: {
    messageId: number;
    messageType?: number;
    senderGuid?: bigint;
    senderEntry?: number;
    subject: string;
    body: string;
    flags?: number;
    expirationTime?: number;
    money?: number;
    itemCount?: number;
  },
): void {
  const msgType = opts.messageType ?? MailMessageType.NORMAL;
  const inner = new PacketWriter();
  inner.uint32LE(opts.messageId);
  inner.uint8(msgType);
  if (msgType === MailMessageType.NORMAL) {
    inner.uint64LE(opts.senderGuid ?? 0n);
  } else {
    inner.uint32LE(opts.senderEntry ?? 0);
  }
  inner.uint32LE(0);
  inner.uint32LE(0);
  inner.uint32LE(41);
  inner.uint32LE(opts.money ?? 0);
  inner.uint32LE(opts.flags ?? MailCheckMask.HAS_BODY);
  inner.floatLE(opts.expirationTime ?? 1.0);
  inner.uint32LE(0);
  inner.cString(opts.subject);
  inner.cString(opts.body);
  inner.uint8(opts.itemCount ?? 0);
  const entryBytes = inner.finish();
  w.uint16LE(entryBytes.byteLength);
  w.rawBytes(entryBytes);
}

describe("parseMailListResult", () => {
  test("parses empty mail list", () => {
    const w = new PacketWriter();
    w.uint32LE(0);
    w.uint8(0);
    const result = parseMailListResult(new PacketReader(w.finish()));
    expect(result.totalCount).toBe(0);
    expect(result.entries).toHaveLength(0);
  });

  test("parses single player mail with body", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.uint8(1);
    writeMailEntry(w, {
      messageId: 100,
      senderGuid: 42n,
      subject: "Test Subject",
      body: "Hello world",
      flags: MailCheckMask.HAS_BODY,
      expirationTime: 2.5,
    });

    const result = parseMailListResult(new PacketReader(w.finish()));
    expect(result.totalCount).toBe(1);
    expect(result.entries).toHaveLength(1);
    const m = result.entries[0]!;
    expect(m.messageId).toBe(100);
    expect(m.messageType).toBe(MailMessageType.NORMAL);
    expect(m.senderGuid).toBe(42n);
    expect(m.subject).toBe("Test Subject");
    expect(m.body).toBe("Hello world");
    expect(m.flags).toBe(MailCheckMask.HAS_BODY);
    expect(m.expirationDays).toBeCloseTo(2.5, 1);
  });

  test("parses auction mail with u32 sender", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.uint8(1);
    writeMailEntry(w, {
      messageId: 200,
      messageType: MailMessageType.AUCTION,
      senderEntry: 555,
      subject: "Auction Won",
      body: "",
      money: 5000,
      flags: MailCheckMask.READ,
    });

    const result = parseMailListResult(new PacketReader(w.finish()));
    const m = result.entries[0]!;
    expect(m.messageType).toBe(MailMessageType.AUCTION);
    expect(m.senderEntry).toBe(555);
    expect(m.senderGuid).toBeUndefined();
    expect(m.money).toBe(5000);
  });

  test("parses creature mail with u32 sender", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.uint8(1);
    writeMailEntry(w, {
      messageId: 300,
      messageType: MailMessageType.CREATURE,
      senderEntry: 12345,
      subject: "NPC Mail",
      body: "Greetings adventurer",
    });

    const result = parseMailListResult(new PacketReader(w.finish()));
    const m = result.entries[0]!;
    expect(m.messageType).toBe(MailMessageType.CREATURE);
    expect(m.senderEntry).toBe(12345);
    expect(m.body).toBe("Greetings adventurer");
  });

  test("skips item data using size field", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.uint8(1);

    const inner = new PacketWriter();
    inner.uint32LE(400);
    inner.uint8(MailMessageType.NORMAL);
    inner.uint64LE(10n);
    inner.uint32LE(0);
    inner.uint32LE(0);
    inner.uint32LE(41);
    inner.uint32LE(0);
    inner.uint32LE(0);
    inner.floatLE(1.0);
    inner.uint32LE(0);
    inner.cString("Items");
    inner.cString("");
    inner.uint8(2);
    for (let i = 0; i < 2; i++) {
      inner.uint8(i);
      inner.uint32LE(i + 1);
      inner.uint32LE(1000 + i);
      for (let j = 0; j < 7; j++) {
        inner.uint32LE(0);
        inner.uint32LE(0);
        inner.uint32LE(0);
      }
      inner.uint32LE(0);
      inner.uint32LE(0);
      inner.uint8(1);
      inner.uint32LE(0);
      inner.uint32LE(100);
      inner.uint32LE(100);
      inner.uint8(0);
    }
    const entryBytes = inner.finish();
    w.uint16LE(entryBytes.byteLength);
    w.rawBytes(entryBytes);

    const result = parseMailListResult(new PacketReader(w.finish()));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.subject).toBe("Items");
    expect(result.entries[0]!.itemCount).toBe(2);
  });

  test("parses multiple mails", () => {
    const w = new PacketWriter();
    w.uint32LE(2);
    w.uint8(2);
    writeMailEntry(w, {
      messageId: 10,
      senderGuid: 1n,
      subject: "Mail 10",
      body: "",
    });
    writeMailEntry(w, {
      messageId: 20,
      senderGuid: 2n,
      subject: "Mail 20",
      body: "",
    });

    const result = parseMailListResult(new PacketReader(w.finish()));
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]!.messageId).toBe(10);
    expect(result.entries[1]!.messageId).toBe(20);
  });
});

describe("parseSendMailResult", () => {
  test("parses SEND action with OK result", () => {
    const w = new PacketWriter();
    w.uint32LE(99);
    w.uint32LE(MailAction.SEND);
    w.uint32LE(MailResult.OK);
    const result = parseSendMailResult(new PacketReader(w.finish()));
    expect(result.mailId).toBe(99);
    expect(result.action).toBe(MailAction.SEND);
    expect(result.result).toBe(MailResult.OK);
  });

  test("parses DELETED action with OK result", () => {
    const w = new PacketWriter();
    w.uint32LE(42);
    w.uint32LE(MailAction.DELETED);
    w.uint32LE(MailResult.OK);
    const result = parseSendMailResult(new PacketReader(w.finish()));
    expect(result.action).toBe(MailAction.DELETED);
    expect(result.result).toBe(MailResult.OK);
  });

  test("parses error result", () => {
    const w = new PacketWriter();
    w.uint32LE(0);
    w.uint32LE(MailAction.SEND);
    w.uint32LE(MailResult.ERR_RECIPIENT_NOT_FOUND);
    const result = parseSendMailResult(new PacketReader(w.finish()));
    expect(result.result).toBe(MailResult.ERR_RECIPIENT_NOT_FOUND);
  });

  test("consumes all bytes", () => {
    const w = new PacketWriter();
    w.uint32LE(1);
    w.uint32LE(0);
    w.uint32LE(0);
    const r = new PacketReader(w.finish());
    parseSendMailResult(r);
    expect(r.remaining).toBe(0);
  });
});

describe("formatMailResultError", () => {
  test("returns undefined for OK", () => {
    expect(formatMailResultError(MailResult.OK)).toBeUndefined();
  });

  test("returns message for CANNOT_SEND_TO_SELF", () => {
    expect(formatMailResultError(MailResult.ERR_CANNOT_SEND_TO_SELF)).toBe(
      "Cannot send mail to yourself.",
    );
  });

  test("returns message for NOT_ENOUGH_MONEY", () => {
    expect(formatMailResultError(MailResult.ERR_NOT_ENOUGH_MONEY)).toBe(
      "Not enough gold to send mail.",
    );
  });

  test("returns message for RECIPIENT_NOT_FOUND", () => {
    expect(formatMailResultError(MailResult.ERR_RECIPIENT_NOT_FOUND)).toBe(
      "Player not found.",
    );
  });

  test("returns message for NOT_YOUR_TEAM", () => {
    expect(formatMailResultError(MailResult.ERR_NOT_YOUR_TEAM)).toBe(
      "Cannot send mail to the opposite faction.",
    );
  });

  test("returns message for INTERNAL_ERROR", () => {
    expect(formatMailResultError(MailResult.ERR_INTERNAL_ERROR)).toBe(
      "Internal mail error.",
    );
  });

  test("returns message for DISABLED_FOR_TRIAL_ACC", () => {
    expect(formatMailResultError(MailResult.ERR_DISABLED_FOR_TRIAL_ACC)).toBe(
      "Trial accounts cannot send mail.",
    );
  });

  test("returns message for RECIPIENT_CAP_REACHED", () => {
    expect(formatMailResultError(MailResult.ERR_RECIPIENT_CAP_REACHED)).toBe(
      "Recipient's mailbox is full.",
    );
  });

  test("returns message for MAIL_AND_CHAT_SUSPENDED", () => {
    expect(formatMailResultError(MailResult.ERR_MAIL_AND_CHAT_SUSPENDED)).toBe(
      "Mail is suspended on this account.",
    );
  });

  test("returns generic message for unknown code", () => {
    expect(formatMailResultError(99)).toBe("Mail error (code 99).");
  });
});

describe("MailCheckMask", () => {
  test("READ is 0x01", () => {
    expect(MailCheckMask.READ).toBe(1);
  });

  test("HAS_BODY is 0x10", () => {
    expect(MailCheckMask.HAS_BODY).toBe(0x10);
  });
});

describe("MailAction", () => {
  test("SEND is 0", () => {
    expect(MailAction.SEND).toBe(0);
  });

  test("DELETED is 4", () => {
    expect(MailAction.DELETED).toBe(4);
  });
});
