import { PacketReader, PacketWriter } from "wow/protocol/packet";

export const MailMessageType = {
  NORMAL: 0,
  AUCTION: 2,
  CREATURE: 3,
  GAMEOBJECT: 4,
  CALENDAR: 5,
} as const;

export const MailCheckMask = {
  NONE: 0x00,
  READ: 0x01,
  RETURNED: 0x02,
  COPIED: 0x04,
  COD_PAYMENT: 0x08,
  HAS_BODY: 0x10,
} as const;

export const MailAction = {
  SEND: 0,
  MONEY_TAKEN: 1,
  ITEM_TAKEN: 2,
  RETURNED_TO_SENDER: 3,
  DELETED: 4,
  MADE_PERMANENT: 5,
} as const;

export const MailResult = {
  OK: 0,
  ERR_EQUIP_ERROR: 1,
  ERR_CANNOT_SEND_TO_SELF: 2,
  ERR_NOT_ENOUGH_MONEY: 3,
  ERR_RECIPIENT_NOT_FOUND: 4,
  ERR_NOT_YOUR_TEAM: 5,
  ERR_INTERNAL_ERROR: 6,
  ERR_DISABLED_FOR_TRIAL_ACC: 14,
  ERR_RECIPIENT_CAP_REACHED: 15,
  ERR_CANT_SEND_WRAPPED_COD: 16,
  ERR_MAIL_AND_CHAT_SUSPENDED: 17,
  ERR_TOO_MANY_ATTACHMENTS: 18,
  ERR_MAIL_ATTACHMENT_INVALID: 19,
  ERR_ITEM_HAS_EXPIRED: 21,
} as const;

export type MailEntry = {
  messageId: number;
  messageType: number;
  senderGuid?: bigint;
  senderEntry?: number;
  cod: number;
  stationery: number;
  money: number;
  flags: number;
  expirationDays: number;
  subject: string;
  body: string;
  itemCount: number;
};

export type MailListResult = {
  totalCount: number;
  entries: MailEntry[];
};

export type SendMailResultPacket = {
  mailId: number;
  action: number;
  result: number;
};

export function parseShowMailbox(r: PacketReader): bigint {
  return r.uint64LE();
}

export function parseMailListResult(r: PacketReader): MailListResult {
  const totalCount = r.uint32LE();
  const count = r.uint8();
  const entries: MailEntry[] = [];
  for (let i = 0; i < count; i++) {
    const size = r.uint16LE();
    const entryStart = r.offset;
    const messageId = r.uint32LE();
    const messageType = r.uint8();
    let senderGuid: bigint | undefined;
    let senderEntry: number | undefined;
    if (messageType === MailMessageType.NORMAL) {
      senderGuid = r.uint64LE();
    } else {
      senderEntry = r.uint32LE();
    }
    const cod = r.uint32LE();
    r.uint32LE();
    const stationery = r.uint32LE();
    const money = r.uint32LE();
    const flags = r.uint32LE();
    const expirationDays = r.floatLE();
    r.uint32LE();
    const subject = r.cString();
    const body = r.cString();
    const itemCount = r.uint8();
    const consumed = r.offset - entryStart;
    if (consumed < size) r.skip(size - consumed);
    entries.push({
      messageId,
      messageType,
      senderGuid,
      senderEntry,
      cod,
      stationery,
      money,
      flags,
      expirationDays,
      subject,
      body,
      itemCount,
    });
  }
  return { totalCount, entries };
}

export function parseSendMailResult(r: PacketReader): SendMailResultPacket {
  return {
    mailId: r.uint32LE(),
    action: r.uint32LE(),
    result: r.uint32LE(),
  };
}

export function buildGetMailList(mailboxGuid: bigint): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(mailboxGuid);
  return w.finish();
}

export function buildSendMail(
  mailboxGuid: bigint,
  receiver: string,
  subject: string,
  body: string,
): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(mailboxGuid);
  w.cString(receiver);
  w.cString(subject);
  w.cString(body);
  w.uint32LE(0);
  w.uint32LE(0);
  w.uint8(0);
  w.uint32LE(0);
  w.uint32LE(0);
  w.uint32LE(0);
  w.uint32LE(0);
  return w.finish();
}

export function buildMailDelete(
  mailboxGuid: bigint,
  mailId: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(mailboxGuid);
  w.uint32LE(mailId);
  w.uint32LE(0);
  return w.finish();
}

export function buildMailMarkAsRead(
  mailboxGuid: bigint,
  mailId: number,
): Uint8Array {
  const w = new PacketWriter();
  w.uint64LE(mailboxGuid);
  w.uint32LE(mailId);
  return w.finish();
}

export function formatMailResultError(result: number): string | undefined {
  switch (result) {
    case MailResult.OK:
      return undefined;
    case MailResult.ERR_CANNOT_SEND_TO_SELF:
      return "Cannot send mail to yourself.";
    case MailResult.ERR_NOT_ENOUGH_MONEY:
      return "Not enough gold to send mail.";
    case MailResult.ERR_RECIPIENT_NOT_FOUND:
      return "Player not found.";
    case MailResult.ERR_NOT_YOUR_TEAM:
      return "Cannot send mail to the opposite faction.";
    case MailResult.ERR_INTERNAL_ERROR:
      return "Internal mail error.";
    case MailResult.ERR_DISABLED_FOR_TRIAL_ACC:
      return "Trial accounts cannot send mail.";
    case MailResult.ERR_RECIPIENT_CAP_REACHED:
      return "Recipient's mailbox is full.";
    case MailResult.ERR_MAIL_AND_CHAT_SUSPENDED:
      return "Mail is suspended on this account.";
    case MailResult.ERR_TOO_MANY_ATTACHMENTS:
      return "Too many attachments.";
    default:
      return `Mail error (code ${result}).`;
  }
}
