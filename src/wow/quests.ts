import type { Entity } from "wow/entity-store";
import {
  ObjectType,
  PLAYER_FIELDS,
  UNIT_FIELDS,
} from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import type { PacketReader } from "wow/protocol/packet";
import {
  buildGossipHello,
  buildGossipSelectOption,
  parseGossipMessage,
  type GossipMessage,
} from "wow/protocol/gossip";
import {
  buildQuestgiverQueryQuest,
  buildQuestgiverAcceptQuest,
  buildQuestgiverCompleteQuest,
  buildQuestgiverRequestReward,
  buildQuestgiverChooseReward,
  parseQuestgiverStatus,
  parseQuestgiverQuestList,
  parseQuestgiverQuestDetails,
  parseQuestgiverRequestItems,
  parseQuestgiverOfferReward,
  parseQuestgiverQuestComplete,
  type QuestgiverStatus,
  type QuestgiverQuestList,
  type QuestgiverQuestDetails,
  type QuestgiverRequestItems,
  type QuestgiverOfferReward,
  type QuestgiverQuestComplete,
} from "wow/protocol/questgiver";
import {
  buildQuestQuery,
  parseQuestQueryResponse,
  type QuestQueryResponse,
} from "wow/protocol/quest-query";
import {
  buildQuestLogRemoveQuest,
  parseQuestUpdateAddKill,
  parseQuestUpdateAddItem,
  parseQuestUpdateComplete,
  parseQuestInvalid,
  parseQuestFailed,
  parseQuestUpdateFailed,
  parseQuestUpdateFailedTimer,
  type QuestUpdateAddKill,
  type QuestUpdateAddItem,
} from "wow/protocol/quest-log";

export const QuestServerOpcode = {
  SMSG_GOSSIP_MESSAGE: GameOpcode.SMSG_GOSSIP_MESSAGE,
  SMSG_GOSSIP_COMPLETE: GameOpcode.SMSG_GOSSIP_COMPLETE,
  SMSG_QUESTGIVER_STATUS: GameOpcode.SMSG_QUESTGIVER_STATUS,
  SMSG_QUESTGIVER_QUEST_LIST: GameOpcode.SMSG_QUESTGIVER_QUEST_LIST,
  SMSG_QUESTGIVER_QUEST_DETAILS: GameOpcode.SMSG_QUESTGIVER_QUEST_DETAILS,
  SMSG_QUESTGIVER_REQUEST_ITEMS: GameOpcode.SMSG_QUESTGIVER_REQUEST_ITEMS,
  SMSG_QUESTGIVER_OFFER_REWARD: GameOpcode.SMSG_QUESTGIVER_OFFER_REWARD,
  SMSG_QUEST_QUERY_RESPONSE: GameOpcode.SMSG_QUEST_QUERY_RESPONSE,
  SMSG_QUESTGIVER_QUEST_COMPLETE: GameOpcode.SMSG_QUESTGIVER_QUEST_COMPLETE,
  SMSG_QUESTGIVER_QUEST_FAILED: GameOpcode.SMSG_QUESTGIVER_QUEST_FAILED,
  SMSG_QUESTUPDATE_COMPLETE: GameOpcode.SMSG_QUESTUPDATE_COMPLETE,
  SMSG_QUESTUPDATE_ADD_KILL: GameOpcode.SMSG_QUESTUPDATE_ADD_KILL,
  SMSG_QUESTGIVER_QUEST_INVALID: GameOpcode.SMSG_QUESTGIVER_QUEST_INVALID,
  SMSG_QUESTLOG_FULL: GameOpcode.SMSG_QUESTLOG_FULL,
  SMSG_QUESTUPDATE_FAILED: GameOpcode.SMSG_QUESTUPDATE_FAILED,
  SMSG_QUESTUPDATE_FAILEDTIMER: GameOpcode.SMSG_QUESTUPDATE_FAILEDTIMER,
  SMSG_QUESTUPDATE_ADD_ITEM: GameOpcode.SMSG_QUESTUPDATE_ADD_ITEM,
} as const;

export type QuestLogSlot = {
  slot: number;
  questId: number | undefined;
  flags: number | undefined;
  counters: [
    number | undefined,
    number | undefined,
    number | undefined,
    number | undefined,
  ];
  expiresAtSeconds: number | undefined;
};

export type QuestLog = { complete: boolean; slots: QuestLogSlot[] };

export type QuestDialog =
  | { kind: "gossip"; data: GossipMessage }
  | { kind: "list"; data: QuestgiverQuestList }
  | { kind: "details"; data: QuestgiverQuestDetails }
  | { kind: "requestItems"; data: QuestgiverRequestItems }
  | { kind: "offer"; data: QuestgiverOfferReward };

export type QuestAction =
  | "talk"
  | "selectOption"
  | "selectQuest"
  | "accept"
  | "complete"
  | "requestReward"
  | "chooseReward"
  | "abandon"
  | "cancel";

export type QuestIntent = {
  action: QuestAction;
  at: number;
  guid?: bigint;
  questId?: number;
  optionId?: number;
  rewardIndex?: number;
  slot?: number;
};

export type QuestQuery =
  | { questId: number; status: "unanswered"; sentAt: number }
  | {
      questId: number;
      status: "known";
      receivedAt: number;
      data: QuestQueryResponse;
    };

export type QuestError = {
  kind:
    | "packet"
    | "stale_dialog"
    | "invalid"
    | "log_full"
    | "quest_failed"
    | "failed"
    | "timer_failed";
  at: number;
  opcode?: number;
  questId?: number;
  reason?: number;
  message?: string;
};

export type QuestProgress =
  | { kind: "kill"; at: number; data: QuestUpdateAddKill }
  | { kind: "item"; at: number; data: QuestUpdateAddItem }
  | { kind: "complete"; at: number; questId: number };

export type QuestState = {
  dialog: QuestDialog | undefined;
  giver: bigint | undefined;
  log: QuestLog;
  queries: QuestQuery[];
  lastIntent: QuestIntent | undefined;
  uncertain: QuestIntent | undefined;
  pending: (QuestIntent & { status: "unanswered" }) | undefined;
  lastError: QuestError | undefined;
  lastProgress: QuestProgress | undefined;
  lastReward: (QuestgiverQuestComplete & { at: number }) | undefined;
  lastStatus: QuestgiverStatus | undefined;
};

export type QuestEvent = {
  type:
    | "intent"
    | "dialog"
    | "closed"
    | "query"
    | "log"
    | "accepted"
    | "progress"
    | "completed"
    | "failed"
    | "removed"
    | "rewarded"
    | "status"
    | "error";
  source: "request" | "packet" | "quest_log" | "lifecycle";
  state: QuestState;
  questId?: number;
};

export type QuestDeps = {
  send: (opcode: number, body?: Uint8Array) => void;
  now: () => number;
  selfGuid: () => bigint;
  getEntity: (guid: bigint) => Entity | undefined;
};

type QuestPacket =
  | { kind: "dialog"; dialog: QuestDialog }
  | { kind: "close" }
  | { kind: "query"; data: QuestQueryResponse }
  | { kind: "reward"; data: QuestgiverQuestComplete }
  | { kind: "status"; data: QuestgiverStatus }
  | {
      kind: "progress";
      data:
        | Omit<Extract<QuestProgress, { kind: "kill" }>, "at">
        | Omit<Extract<QuestProgress, { kind: "item" }>, "at">
        | Omit<Extract<QuestProgress, { kind: "complete" }>, "at">;
    }
  | { kind: "error"; error: Omit<QuestError, "at"> };

const packetOpcodes = new Set<number>(Object.values(QuestServerOpcode));
const dialogOpcodes = new Set<number>([
  QuestServerOpcode.SMSG_GOSSIP_MESSAGE,
  QuestServerOpcode.SMSG_GOSSIP_COMPLETE,
  QuestServerOpcode.SMSG_QUESTGIVER_QUEST_LIST,
  QuestServerOpcode.SMSG_QUESTGIVER_QUEST_DETAILS,
  QuestServerOpcode.SMSG_QUESTGIVER_REQUEST_ITEMS,
  QuestServerOpcode.SMSG_QUESTGIVER_OFFER_REWARD,
]);

function field(entity: Entity | undefined, offset: number): number | undefined {
  return (
    entity?.rawFields.get(offset) ?? (entity?.createComplete ? 0 : undefined)
  );
}

function logSlot(
  entity: Entity | undefined,
  slot: number,
  idsVisible: boolean,
): QuestLogSlot {
  const offset = PLAYER_FIELDS.QUEST_LOG.offset + slot * 5;
  const low = field(entity, offset + 2);
  const high = field(entity, offset + 3);
  return {
    slot,
    questId: entity?.rawFields.get(offset) ?? (idsVisible ? 0 : undefined),
    flags: field(entity, offset + 1),
    counters: [
      low === undefined ? undefined : low & 0xffff,
      low === undefined ? undefined : low >>> 16,
      high === undefined ? undefined : high & 0xffff,
      high === undefined ? undefined : high >>> 16,
    ],
    expiresAtSeconds: field(entity, offset + 4),
  };
}

export function readQuestLog(
  selfGuid: bigint,
  getEntity: QuestDeps["getEntity"],
  questIdsVisibleAtCreate = false,
): QuestLog {
  const candidate = selfGuid === 0n ? undefined : getEntity(selfGuid);
  const entity =
    candidate?.guid === selfGuid && candidate.objectType === ObjectType.PLAYER
      ? candidate
      : undefined;
  const idsVisible = !!entity?.createComplete && questIdsVisibleAtCreate;
  const slots = Array.from({ length: 25 }, (_, slot) =>
    logSlot(entity, slot, idsVisible),
  );
  const complete = slots.every(
    (slot) =>
      slot.questId !== undefined &&
      slot.flags !== undefined &&
      slot.expiresAtSeconds !== undefined &&
      slot.counters.every((count) => count !== undefined),
  );
  return { complete, slots };
}

function sameSlot(a: QuestLogSlot, b: QuestLogSlot): boolean {
  return (
    a.questId === b.questId &&
    a.flags === b.flags &&
    a.expiresAtSeconds === b.expiresAtSeconds &&
    a.counters.every((count, i) => count === b.counters[i])
  );
}

function positiveId(id: number): void {
  if (!Number.isInteger(id) || id <= 0 || id > 0xffffffff)
    throw new Error("invalid_quest_id");
}

function empty(reader: PacketReader): void {
  if (reader.remaining !== 0) throw new RangeError("Unexpected quest payload");
}

function decodeDialog(opcode: number, reader: PacketReader): QuestPacket {
  switch (opcode) {
    case QuestServerOpcode.SMSG_GOSSIP_MESSAGE:
      return {
        kind: "dialog",
        dialog: { kind: "gossip", data: parseGossipMessage(reader) },
      };
    case QuestServerOpcode.SMSG_QUESTGIVER_QUEST_LIST:
      return {
        kind: "dialog",
        dialog: { kind: "list", data: parseQuestgiverQuestList(reader) },
      };
    case QuestServerOpcode.SMSG_QUESTGIVER_QUEST_DETAILS:
      return {
        kind: "dialog",
        dialog: { kind: "details", data: parseQuestgiverQuestDetails(reader) },
      };
    case QuestServerOpcode.SMSG_QUESTGIVER_REQUEST_ITEMS:
      return {
        kind: "dialog",
        dialog: {
          kind: "requestItems",
          data: parseQuestgiverRequestItems(reader),
        },
      };
    case QuestServerOpcode.SMSG_QUESTGIVER_OFFER_REWARD:
      return {
        kind: "dialog",
        dialog: { kind: "offer", data: parseQuestgiverOfferReward(reader) },
      };
    default:
      empty(reader);
      return { kind: "close" };
  }
}

function decodeError(opcode: number, reader: PacketReader): QuestPacket {
  switch (opcode) {
    case QuestServerOpcode.SMSG_QUESTGIVER_QUEST_INVALID:
      return {
        kind: "error",
        error: { kind: "invalid", ...parseQuestInvalid(reader) },
      };
    case QuestServerOpcode.SMSG_QUESTGIVER_QUEST_FAILED:
      return {
        kind: "error",
        error: { kind: "quest_failed", ...parseQuestFailed(reader) },
      };
    case QuestServerOpcode.SMSG_QUESTUPDATE_FAILED:
      return {
        kind: "error",
        error: { kind: "failed", ...parseQuestUpdateFailed(reader) },
      };
    case QuestServerOpcode.SMSG_QUESTUPDATE_FAILEDTIMER:
      return {
        kind: "error",
        error: { kind: "timer_failed", ...parseQuestUpdateFailedTimer(reader) },
      };
    default:
      empty(reader);
      return { kind: "error", error: { kind: "log_full" } };
  }
}

function decodePacket(opcode: number, reader: PacketReader): QuestPacket {
  if (dialogOpcodes.has(opcode)) return decodeDialog(opcode, reader);
  switch (opcode) {
    case QuestServerOpcode.SMSG_QUEST_QUERY_RESPONSE:
      return { kind: "query", data: parseQuestQueryResponse(reader) };
    case QuestServerOpcode.SMSG_QUESTGIVER_QUEST_COMPLETE:
      return { kind: "reward", data: parseQuestgiverQuestComplete(reader) };
    case QuestServerOpcode.SMSG_QUESTGIVER_STATUS:
      return { kind: "status", data: parseQuestgiverStatus(reader) };
    case QuestServerOpcode.SMSG_QUESTUPDATE_ADD_KILL:
      return {
        kind: "progress",
        data: { kind: "kill", data: parseQuestUpdateAddKill(reader) },
      };
    case QuestServerOpcode.SMSG_QUESTUPDATE_ADD_ITEM:
      return {
        kind: "progress",
        data: { kind: "item", data: parseQuestUpdateAddItem(reader) },
      };
    case QuestServerOpcode.SMSG_QUESTUPDATE_COMPLETE:
      return {
        kind: "progress",
        data: { kind: "complete", ...parseQuestUpdateComplete(reader) },
      };
    default:
      return decodeError(opcode, reader);
  }
}

export class QuestRuntime {
  private listener: ((event: QuestEvent) => void) | undefined;
  private disposed = false;
  private dialog: QuestDialog | undefined;
  private giver: bigint | undefined;
  private log: QuestLog;
  private logEntity: Entity | undefined;
  private readonly visibleQuestIds = new WeakMap<Entity, boolean>();
  private readonly queries = new Map<number, QuestQuery>();
  private lastIntent: QuestIntent | undefined;
  private uncertain: QuestIntent | undefined;
  private pending: QuestState["pending"];
  private lastError: QuestError | undefined;
  private lastProgress: QuestProgress | undefined;
  private lastReward: QuestState["lastReward"];
  private lastStatus: QuestgiverStatus | undefined;

  constructor(private readonly deps: QuestDeps) {
    this.log = readQuestLog(deps.selfGuid(), deps.getEntity);
    this.logEntity = deps.getEntity(deps.selfGuid());
  }

  onEvent(callback: ((event: QuestEvent) => void) | undefined): void {
    this.listener = this.disposed ? undefined : callback;
  }

  snapshot(): QuestState {
    return structuredClone({
      dialog: this.dialog,
      giver: this.giver,
      log: this.log,
      queries: [...this.queries.values()],
      lastIntent: this.lastIntent,
      pending: this.pending,
      uncertain: this.uncertain,
      lastError: this.lastError,
      lastProgress: this.lastProgress,
      lastReward: this.lastReward,
      lastStatus: this.lastStatus,
    });
  }

  talk(guid: bigint): void {
    this.active();
    if (guid <= 0n || guid > 0xffffffffffffffffn)
      throw new Error("invalid_guid");
    this.send(GameOpcode.CMSG_GOSSIP_HELLO, buildGossipHello(guid), {
      action: "talk",
      guid,
    });
  }

  query(questId: number): void {
    this.active();
    positiveId(questId);
    this.deps.send(GameOpcode.CMSG_QUEST_QUERY, buildQuestQuery(questId));
    if (this.queries.get(questId)?.status !== "known")
      this.queries.set(questId, {
        questId,
        status: "unanswered",
        sentAt: this.deps.now(),
      });
    this.emit("query", "request", questId);
  }

  selectOption(optionId: number, code?: string): void {
    this.active();
    const dialog = this.dialog;
    if (dialog?.kind !== "gossip") throw new Error("gossip_not_open");
    const option = dialog.data.options.find(
      (entry) => entry.optionIndex === optionId,
    );
    if (!option) throw new Error("option_not_offered");
    if (option.coded && code === undefined)
      throw new Error("gossip_code_required");
    if (!option.coded && code !== undefined)
      throw new Error("gossip_code_not_offered");
    const { guid, menuId } = dialog.data;
    const body = buildGossipSelectOption({
      guid,
      menuId,
      optionIndex: optionId,
      code,
    });
    this.send(GameOpcode.CMSG_GOSSIP_SELECT_OPTION, body, {
      action: "selectOption",
      guid,
      optionId,
    });
  }

  selectQuest(questId: number): void {
    this.active();
    positiveId(questId);
    const dialog = this.dialog;
    if (dialog?.kind !== "gossip" && dialog?.kind !== "list")
      throw new Error("quest_not_offered");
    const entry = dialog.data.quests.find((quest) => quest.questId === questId);
    if (!entry) throw new Error("quest_not_offered");
    if (entry.icon === 4) {
      this.complete(questId);
      return;
    }
    const guid = dialog.data.guid;
    const body = buildQuestgiverQueryQuest(guid, questId, 0);
    this.send(GameOpcode.CMSG_QUESTGIVER_QUERY_QUEST, body, {
      action: "selectQuest",
      guid,
      questId,
    });
  }

  accept(): void {
    this.active();
    const dialog = this.dialog;
    if (dialog?.kind !== "details") throw new Error("quest_details_not_open");
    if (!dialog.data.activateAccept)
      throw new Error("quest_accept_not_offered");
    const { guid, questId } = dialog.data;
    const body = buildQuestgiverAcceptQuest(guid, questId, 0);
    this.send(GameOpcode.CMSG_QUESTGIVER_ACCEPT_QUEST, body, {
      action: "accept",
      guid,
      questId,
    });
  }

  complete(questId: number): void {
    this.active();
    positiveId(questId);
    const guid = this.offeredGiver(questId);
    const body = buildQuestgiverCompleteQuest(guid, questId);
    this.send(GameOpcode.CMSG_QUESTGIVER_COMPLETE_QUEST, body, {
      action: "complete",
      guid,
      questId,
    });
  }

  requestReward(): void {
    this.active();
    const dialog = this.dialog;
    if (dialog?.kind !== "requestItems")
      throw new Error("quest_request_items_not_open");
    if ((dialog.data.completionFlags[0] & 3) !== 3)
      throw new Error("quest_requirements_unmet");
    const { guid, questId } = dialog.data;
    const body = buildQuestgiverRequestReward(guid, questId);
    this.send(GameOpcode.CMSG_QUESTGIVER_REQUEST_REWARD, body, {
      action: "requestReward",
      guid,
      questId,
    });
  }

  chooseReward(index: number): void {
    this.active();
    const dialog = this.dialog;
    if (dialog?.kind !== "offer") throw new Error("reward_offer_not_open");
    const count = dialog.data.rewards.choices.length;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= Math.max(1, count) ||
      index >= 6
    )
      throw new Error("reward_not_offered");
    const { guid, questId } = dialog.data;
    const body = buildQuestgiverChooseReward(guid, questId, index);
    this.send(GameOpcode.CMSG_QUESTGIVER_CHOOSE_REWARD, body, {
      action: "chooseReward",
      guid,
      questId,
      rewardIndex: index,
    });
  }

  abandon(slot: number): void {
    this.active();
    if (!Number.isInteger(slot) || slot < 0 || slot >= 25)
      throw new Error("invalid_quest_slot");
    const entry = this.readLog().slots[slot];
    if (entry?.questId === undefined) throw new Error("quest_slot_unknown");
    if (entry.questId === 0) throw new Error("quest_slot_empty");
    const body = buildQuestLogRemoveQuest(slot);
    this.send(GameOpcode.CMSG_QUESTLOG_REMOVE_QUEST, body, {
      action: "abandon",
      slot,
      questId: entry.questId,
    });
  }

  cancel(): void {
    this.active();
    if (this.pending?.action === "cancel")
      throw new Error("quest_cancel_unanswered");
    this.deps.send(GameOpcode.CMSG_QUESTGIVER_CANCEL);
    this.uncertain = this.pending;
    this.dialog = undefined;
    this.lastIntent = {
      action: "cancel",
      at: this.deps.now(),
      guid: this.giver,
    };
    this.pending = { ...this.lastIntent, status: "unanswered" };
    this.emit("intent", "request");
  }

  handlePacket(opcode: number, reader: PacketReader): boolean {
    if (this.disposed || !packetOpcodes.has(opcode)) return false;
    let packet: QuestPacket;
    try {
      packet = decodePacket(opcode, reader);
    } catch (error) {
      if (dialogOpcodes.has(opcode)) this.dialog = undefined;
      this.lastError = {
        kind: "packet",
        opcode,
        at: this.deps.now(),
        message: error instanceof Error ? error.message : String(error),
      };
      this.emit("error", "packet");
      return true;
    }
    this.receive(packet);
    return true;
  }

  observeSelfCreate(entity: Entity): void {
    if (
      this.disposed ||
      entity.guid !== this.deps.selfGuid() ||
      entity.objectType !== ObjectType.PLAYER ||
      !entity.createComplete
    )
      return;
    if (this.visibleQuestIds.has(entity)) return;
    this.resetInteraction();
    const offsets = [
      UNIT_FIELDS.CHARMEDBY.offset,
      UNIT_FIELDS.SUMMONEDBY.offset,
    ];
    const visible = offsets.every(
      (offset) =>
        field(entity, offset) === 0 && field(entity, offset + 1) === 0,
    );
    this.visibleQuestIds.set(entity, visible);
  }

  observeQuestLog(): void {
    if (this.disposed) return;
    const next = this.readLog();
    const entity = this.deps.getEntity(this.deps.selfGuid());
    const previous = this.log;
    const sameEntity = entity === this.logEntity;
    this.log = next;
    this.logEntity = entity;
    if (
      sameEntity &&
      previous.slots.every((slot, i) => sameSlot(slot, next.slots[i]!))
    )
      return;
    if (sameEntity) this.transitions(previous, next);
    this.emit("log", "quest_log");
  }

  resetInteraction(): void {
    if (this.disposed) return;
    const open =
      this.dialog !== undefined ||
      this.giver !== undefined ||
      this.pending !== undefined;
    if (this.pending) this.uncertain = this.pending;
    this.dialog = undefined;
    this.giver = undefined;
    this.pending = undefined;
    if (open) this.emit("closed", "lifecycle");
  }

  dispose(): void {
    this.disposed = true;
    this.listener = undefined;
    this.dialog = undefined;
    this.giver = undefined;
    this.pending = undefined;
    this.queries.clear();
  }

  private readLog(): QuestLog {
    const entity = this.deps.getEntity(this.deps.selfGuid());
    return readQuestLog(
      this.deps.selfGuid(),
      this.deps.getEntity,
      !!entity && this.visibleQuestIds.get(entity) === true,
    );
  }

  private active(): void {
    if (this.disposed) throw new Error("quests_disposed");
  }

  private emit(
    type: QuestEvent["type"],
    source: QuestEvent["source"],
    questId?: number,
  ): void {
    if (this.listener)
      this.listener({ type, source, questId, state: this.snapshot() });
  }

  private send(
    opcode: number,
    body: Uint8Array,
    intent: Omit<QuestIntent, "at">,
  ): void {
    if (this.pending) throw new Error("quest_reply_unanswered");
    this.deps.send(opcode, body);
    this.lastIntent = { ...intent, at: this.deps.now() };
    this.pending = { ...this.lastIntent, status: "unanswered" };
    if (intent.action !== "abandon") {
      this.dialog = undefined;
      this.giver = intent.guid;
    }
    this.lastError = undefined;
    this.emit("intent", "request", intent.questId);
  }

  private offeredGiver(questId: number): bigint {
    const dialog = this.dialog;
    if (!dialog) throw new Error("quest_not_offered");
    if (dialog.kind === "gossip" || dialog.kind === "list") {
      if (dialog.data.quests.some((entry) => entry.questId === questId))
        return dialog.data.guid;
    } else if (dialog.data.questId === questId) return dialog.data.guid;
    throw new Error("quest_not_offered");
  }

  private receive(packet: QuestPacket): void {
    switch (packet.kind) {
      case "dialog":
        this.receiveDialog(packet.dialog);
        return;
      case "close":
        this.closeDialog();
        return;
      case "query":
        this.queries.set(packet.data.questId, {
          questId: packet.data.questId,
          status: "known",
          receivedAt: this.deps.now(),
          data: packet.data,
        });
        this.emit("query", "packet", packet.data.questId);
        return;
      case "reward":
        this.lastReward = { ...packet.data, at: this.deps.now() };
        this.resolve("chooseReward", packet.data.questId);
        this.emit("rewarded", "packet", packet.data.questId);
        return;
      case "status":
        this.lastStatus = packet.data;
        this.emit("status", "packet");
        return;
      case "progress":
        this.receiveProgress(packet.data);
        return;
      case "error":
        this.receiveError(packet.error);
        return;
    }
  }

  private receiveDialog(dialog: QuestDialog): void {
    const expected = this.pending;
    const wrongQuest =
      expected?.questId !== undefined &&
      "questId" in dialog.data &&
      dialog.data.questId !== expected.questId;
    if (
      dialog.data.guid !== this.giver ||
      wrongQuest ||
      !this.expectedDialog(dialog)
    ) {
      this.lastError = { kind: "stale_dialog", at: this.deps.now() };
      this.emit("error", "packet");
      return;
    }
    this.dialog = dialog;
    if (expected) this.pending = undefined;
    this.emit(
      "dialog",
      "packet",
      "questId" in dialog.data ? dialog.data.questId : undefined,
    );
  }

  private closeDialog(): void {
    this.dialog = undefined;
    this.giver = undefined;
    if (this.pending?.action !== "abandon") {
      if (this.pending && this.pending.action !== "cancel")
        this.uncertain = this.pending;
      this.pending = undefined;
    }
    this.emit("closed", "packet");
  }

  private expectedDialog(dialog: QuestDialog): boolean {
    switch (this.pending?.action) {
      case "accept":
      case "abandon":
      case "cancel":
        return false;
      case "selectQuest":
        return (
          dialog.kind === "details" ||
          dialog.kind === "requestItems" ||
          dialog.kind === "offer"
        );
      case "complete":
        return dialog.kind === "requestItems" || dialog.kind === "offer";
      case "requestReward":
      case "chooseReward":
        return dialog.kind === "offer";
      default:
        return true;
    }
  }

  private receiveProgress(
    progress: Extract<QuestPacket, { kind: "progress" }>["data"],
  ): void {
    this.lastProgress = { ...progress, at: this.deps.now() };
    let questId: number | undefined;
    if (progress.kind === "kill") questId = progress.data.questId;
    if (progress.kind === "complete") questId = progress.questId;
    this.emit(
      progress.kind === "complete" ? "completed" : "progress",
      "packet",
      questId,
    );
  }

  private receiveError(error: Omit<QuestError, "at">): void {
    this.lastError = { ...error, at: this.deps.now() };
    if (
      this.pending?.action !== "cancel" &&
      (error.questId === undefined || error.questId === this.pending?.questId)
    ) {
      this.pending = undefined;
      this.dialog = undefined;
    }
    this.emit("error", "packet", error.questId);
  }

  private resolve(action: QuestAction, questId: number): void {
    if (this.pending?.action === action && this.pending.questId === questId)
      this.pending = undefined;
  }

  private transitions(previous: QuestLog, next: QuestLog): void {
    const before = new Map(
      previous.slots
        .filter((slot) => slot.questId)
        .map((slot) => [slot.questId!, slot]),
    );
    const after = new Map(
      next.slots
        .filter((slot) => slot.questId)
        .map((slot) => [slot.questId!, slot]),
    );
    const beforeKnown = previous.slots.every(
      (slot) => slot.questId !== undefined,
    );
    const afterKnown = next.slots.every((slot) => slot.questId !== undefined);
    for (const [id, slot] of after) {
      const old = before.get(id);
      if (!old && beforeKnown) {
        this.resolve("accept", id);
        this.emit("accepted", "quest_log", id);
        if (slot.flags !== undefined && slot.flags & 1)
          this.emit("completed", "quest_log", id);
        if (slot.flags !== undefined && slot.flags & 2)
          this.emit("failed", "quest_log", id);
      }
      if (old) this.slotProgress(old, slot);
    }
    if (!afterKnown) return;
    for (const id of before.keys()) {
      if (after.has(id)) continue;
      this.resolve("abandon", id);
      this.emit("removed", "quest_log", id);
    }
  }

  private slotProgress(previous: QuestLogSlot, next: QuestLogSlot): void {
    const flags = next.flags;
    if (flags !== undefined && previous.flags !== undefined) {
      if (flags & 1 && !(previous.flags & 1))
        this.emit("completed", "quest_log", next.questId);
      if (flags & 2 && !(previous.flags & 2))
        this.emit("failed", "quest_log", next.questId);
    }
    if (!sameSlot(previous, next))
      this.emit("progress", "quest_log", next.questId);
  }
}
