import type { Entity } from "wow/entity-store";
import {
  ObjectType,
  PLAYER_FIELDS,
  UNIT_FIELDS,
} from "wow/protocol/entity-fields";
import { GameOpcode } from "wow/protocol/opcodes";
import {
  buildGossipHello,
  buildGossipSelectOption,
  type GossipMessage,
} from "wow/protocol/gossip";
import {
  buildQuestgiverQueryQuest,
  buildQuestgiverAcceptQuest,
  buildQuestgiverCompleteQuest,
  buildQuestgiverRequestReward,
  buildQuestgiverChooseReward,
  type QuestgiverStatus,
  type QuestgiverQuestList,
  type QuestgiverQuestDetails,
  type QuestgiverRequestItems,
  type QuestgiverOfferReward,
  type QuestgiverQuestComplete,
} from "wow/protocol/questgiver";
import {
  buildQuestQuery,
  type QuestQueryResponse,
} from "wow/protocol/quest-query";
import {
  buildQuestLogRemoveQuest,
  type QuestUpdateAddKill,
  type QuestUpdateAddItem,
} from "wow/protocol/quest-log";

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
    | "stale_dialog"
    | "invalid"
    | "log_full"
    | "quest_failed"
    | "failed"
    | "timer_failed";
  at: number;
  questId?: number;
  reason?: number;
};

export type QuestProgressUpdate =
  | { kind: "kill"; data: QuestUpdateAddKill }
  | { kind: "item"; data: QuestUpdateAddItem }
  | { kind: "complete"; questId: number };

export type QuestProgress = QuestProgressUpdate & { at: number };

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

  openDialog(dialog: QuestDialog): void {
    if (this.disposed) return;
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

  closeDialog(): void {
    if (this.disposed) return;
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

  receiveQuery(data: QuestQueryResponse): void {
    if (this.disposed) return;
    this.queries.set(data.questId, {
      questId: data.questId,
      status: "known",
      receivedAt: this.deps.now(),
      data,
    });
    this.emit("query", "packet", data.questId);
  }

  receiveReward(data: QuestgiverQuestComplete): void {
    if (this.disposed) return;
    this.lastReward = { ...data, at: this.deps.now() };
    this.resolve("chooseReward", data.questId);
    this.emit("rewarded", "packet", data.questId);
  }

  receiveStatus(data: QuestgiverStatus): void {
    if (this.disposed) return;
    this.lastStatus = data;
    this.emit("status", "packet");
  }

  receiveProgress(progress: QuestProgressUpdate): void {
    if (this.disposed) return;
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

  receiveError(error: Omit<QuestError, "at">): void {
    if (this.disposed) return;
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
