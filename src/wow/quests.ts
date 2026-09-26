import { Emitter, type Unsubscribe } from "lib/emitter";
import type { Entity, EntityLookup } from "wow/entity-store";
import { readInventory } from "wow/inventory";
import { ObjectType } from "wow/protocol/entity-fields";
import type { ItemPushResult } from "wow/protocol/loot";
import { GameOpcode } from "wow/protocol/opcodes";
import type {
  QuestUpdateAddItem,
  QuestUpdateAddKill,
} from "wow/protocol/quest-log";
import {
  buildQuestQuery,
  type QuestQueryResponse,
} from "wow/protocol/quest-query";
import type {
  QuestgiverQuestComplete,
  QuestgiverStatus,
} from "wow/protocol/questgiver";
import {
  itemObjectives,
  type QuestCollect,
  type QuestItemObjective,
  type QuestItemPush,
  settleItemPushes,
} from "wow/quest-items";
import {
  type QuestLog,
  questLogChanges,
  readQuestLog,
  sameSlot,
} from "wow/quest-slots";
import {
  abandonRequest,
  acceptRequest,
  chooseRewardRequest,
  completeRequest,
  expectedDialog,
  positiveId,
  QUEST_REPLY_TIMEOUT_MS,
  type QuestAction,
  type QuestDialog,
  type QuestIntent,
  type QuestRequest,
  type QuestUnresolvedReason,
  type QuestWindow,
  questIdsVisible,
  requestRewardRequest,
  selectOptionRequest,
  selectQuestRequest,
  talkRequest,
  unansweredError,
} from "wow/quests-requests";

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
    | "timer_failed"
    | "unsupported_window";
  at: number;
  questId?: number;
  reason?: number;
  window?: QuestWindow;
  guid?: bigint;
};

export type QuestProgressUpdate =
  | { kind: "kill"; data: QuestUpdateAddKill }
  | { kind: "item"; data: QuestUpdateAddItem }
  | { kind: "complete"; questId: number };

export type QuestProgress = (QuestProgressUpdate | QuestCollect) & {
  at: number;
};

export type QuestState = {
  dialog: QuestDialog | undefined;
  giver: bigint | undefined;
  log: QuestLog;
  queries: QuestQuery[];
  lastIntent: QuestIntent | undefined;
  unresolved: (QuestIntent & { reason: QuestUnresolvedReason })[];
  pending: (QuestIntent & { status: "unanswered" }) | undefined;
  lastError: QuestError | undefined;
  lastProgress: QuestProgress | undefined;
  items: QuestItemObjective[];
  itemPushes: QuestItemPush[];
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
    | "error"
    | "expired"
    | "window";
  source: "request" | "packet" | "quest_log" | "inventory" | "lifecycle";
  state: QuestState;
  questId?: number;
  detail?: string;
};

export type QuestDeps = {
  send: (opcode: number, body?: Uint8Array) => void;
  now: () => number;
  selfGuid: () => bigint;
  getEntity: EntityLookup;
};

export class QuestRuntime {
  private readonly events = new Emitter<[QuestEvent]>();
  private disposed = false;
  private dialog: QuestDialog | undefined;
  private giver: bigint | undefined;
  private log: QuestLog;
  private logEntity: Entity | undefined;
  private readonly visibleQuestIds = new WeakMap<Entity, boolean>();
  private readonly queries = new Map<number, QuestQuery>();
  private lastIntent: QuestIntent | undefined;
  private unresolved: QuestState["unresolved"] = [];
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private pending: QuestState["pending"];
  private lastError: QuestError | undefined;
  private lastProgress: QuestProgress | undefined;
  private itemPushes: QuestItemPush[] = [];
  private lastReward: QuestState["lastReward"];
  private lastStatus: QuestgiverStatus | undefined;
  private readonly deps: QuestDeps;

  constructor(deps: QuestDeps) {
    this.deps = deps;
    this.log = readQuestLog(deps.selfGuid(), deps.getEntity);
    this.logEntity = deps.getEntity(deps.selfGuid());
  }

  onEvent(listener: (event: QuestEvent) => void): Unsubscribe {
    if (this.disposed) return () => undefined;
    return this.events.subscribe(listener);
  }

  snapshot(): QuestState {
    this.expire();
    return this.state();
  }

  private state(): QuestState {
    return structuredClone({
      dialog: this.dialog,
      giver: this.giver,
      log: this.log,
      queries: [...this.queries.values()],
      lastIntent: this.lastIntent,
      pending: this.pending,
      unresolved: this.unresolved,
      lastError: this.lastError,
      lastProgress: this.lastProgress,
      items: this.itemObjectives(),
      itemPushes: this.itemPushes,
      lastReward: this.lastReward,
      lastStatus: this.lastStatus,
    });
  }

  talk(guid: bigint): void {
    this.active();
    this.send(talkRequest(guid));
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
    this.send(selectOptionRequest(this.dialog, optionId, code));
  }

  selectQuest(questId: number): void {
    this.active();
    const request = selectQuestRequest(this.dialog, questId);
    if (request === "turnIn") {
      this.complete(questId);
      return;
    }
    this.send(request);
  }

  accept(): void {
    this.active();
    this.send(acceptRequest(this.dialog, this.readLog()));
  }

  complete(questId: number): void {
    this.active();
    this.send(completeRequest(this.dialog, questId));
  }

  requestReward(): void {
    this.active();
    this.send(requestRewardRequest(this.dialog));
  }

  chooseReward(index: number): void {
    this.active();
    this.send(chooseRewardRequest(this.dialog, index));
  }

  abandon(slot: number): void {
    this.active();
    this.send(abandonRequest(slot, () => this.readLog()));
  }

  cancel(): void {
    this.active();
    if (this.pending?.action === "cancel")
      throw new Error(
        `quest_cancel_unanswered: waiting for the server to close the dialog; it expires as no_reply after ${QUEST_REPLY_TIMEOUT_MS / 1000}s`,
      );
    this.deps.send(GameOpcode.CMSG_QUESTGIVER_CANCEL);
    this.leaveUnresolved("cancelled");
    this.dialog = undefined;
    this.lastIntent = {
      action: "cancel",
      at: this.deps.now(),
      guid: this.giver,
    };
    this.pending = { ...this.lastIntent, status: "unanswered" };
    this.arm();
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
    this.visibleQuestIds.set(entity, questIdsVisible(entity));
  }

  observeQuestLog(): void {
    if (this.disposed) return;
    const next = this.readLog();
    const entity = this.deps.getEntity(this.deps.selfGuid());
    const previous = this.log;
    const sameEntity = entity === this.logEntity;
    this.log = next;
    this.logEntity = entity;
    this.settleItems();
    if (
      sameEntity &&
      previous.slots.every((slot, i) => {
        const nextSlot = next.slots[i];
        if (nextSlot === undefined)
          throw new Error("quest slots length mismatch");
        return sameSlot(slot, nextSlot);
      })
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
    this.leaveUnresolved("reset");
    this.dialog = undefined;
    this.giver = undefined;
    this.pending = undefined;
    if (open) this.emit("closed", "lifecycle");
  }

  dispose(): void {
    this.disposed = true;
    this.events.clear();
    clearTimeout(this.expiry);
    this.dialog = undefined;
    this.giver = undefined;
    this.pending = undefined;
    this.unresolved = [];
    this.itemPushes = [];
    this.queries.clear();
  }

  private readLog(): QuestLog {
    const entity = this.deps.getEntity(this.deps.selfGuid());
    return readQuestLog(
      this.deps.selfGuid(),
      this.deps.getEntity,
      entity !== undefined && this.visibleQuestIds.get(entity) === true,
    );
  }

  private itemObjectives(): QuestItemObjective[] {
    return itemObjectives(
      this.log,
      this.queries,
      readInventory(this.deps.selfGuid(), this.deps.getEntity),
    );
  }

  private settleItems(): void {
    if (this.itemPushes.length === 0) return;
    const { settled, waiting } = settleItemPushes(
      this.itemPushes,
      this.itemObjectives(),
    );
    this.itemPushes = waiting;
    for (const collect of settled) {
      this.lastProgress = { ...collect, at: this.deps.now() };
      this.emit("progress", "inventory", collect.questId);
    }
  }

  private active(): void {
    if (this.disposed) throw new Error("quests_disposed");
    this.expire();
  }

  private emit(
    type: QuestEvent["type"],
    source: QuestEvent["source"],
    questId?: number,
    detail?: string,
  ): void {
    if (this.events.size > 0)
      this.events.emit({ type, source, questId, detail, state: this.state() });
  }

  private arm(): void {
    clearTimeout(this.expiry);
    this.expiry = setTimeout(() => this.expire(), QUEST_REPLY_TIMEOUT_MS + 25);
    this.expiry.unref?.();
  }

  private expire(): void {
    const pending = this.pending;
    if (
      this.disposed ||
      !pending ||
      this.deps.now() - pending.at < QUEST_REPLY_TIMEOUT_MS
    )
      return;
    this.leaveUnresolved("no_reply");
    this.pending = undefined;
    if (pending.action !== "abandon") {
      this.dialog = undefined;
      this.giver = undefined;
    }
    this.emit("expired", "lifecycle", pending.questId, "no_reply");
  }

  receiveWindow(guid: bigint, window: QuestWindow): void {
    if (this.disposed) return;
    this.expire();
    if (this.giver !== guid) return;
    const answered =
      this.pending?.action === "talk" ||
      this.pending?.action === "selectOption";
    if (answered) this.pending = undefined;
    this.dialog = undefined;
    this.giver = undefined;
    if (window === "trainer" || window === "vendor") {
      this.emit("window", "packet", undefined, window);
      return;
    }
    this.lastError = {
      kind: "unsupported_window",
      at: this.deps.now(),
      window,
      guid,
    };
    this.emit("window", "packet", undefined, `unsupported_window:${window}`);
  }

  private send({ opcode, body, intent }: QuestRequest): void {
    if (this.pending) throw unansweredError(this.pending, this.deps.now());
    this.deps.send(opcode, body);
    this.lastIntent = { ...intent, at: this.deps.now() };
    this.pending = { ...this.lastIntent, status: "unanswered" };
    this.arm();
    if (intent.action !== "abandon") {
      this.dialog = undefined;
      this.giver = intent.guid;
    }
    this.lastError = undefined;
    this.emit("intent", "request", intent.questId);
  }

  openDialog(dialog: QuestDialog): void {
    if (this.disposed) return;
    this.expire();
    const expected = this.pending;
    const wrongQuest =
      expected?.questId !== undefined &&
      "questId" in dialog.data &&
      dialog.data.questId !== expected.questId;
    if (
      dialog.data.guid !== this.giver ||
      wrongQuest ||
      !expectedDialog(this.pending?.action, dialog)
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
      this.leaveUnresolved("closed");
      this.pending = undefined;
    }
    this.emit("closed", "packet");
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

  receiveItemPush(push: ItemPushResult): void {
    if (this.disposed || push.guid !== this.deps.selfGuid()) return;
    if (!this.itemObjectives().some((o) => o.itemId === push.itemId)) return;
    this.itemPushes.push({ ...push, at: this.deps.now() });
    this.settleItems();
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

  private leaveUnresolved(reason: QuestUnresolvedReason): void {
    if (!this.pending || this.pending.action === "cancel") return;
    const { status: _status, ...intent } = this.pending;
    this.unresolved.push({ ...intent, reason });
  }

  private resolve(action: QuestAction, questId: number): void {
    if (this.pending?.action === action && this.pending.questId === questId)
      this.pending = undefined;
    this.unresolved = this.unresolved.filter(
      (intent) => intent.action !== action || intent.questId !== questId,
    );
  }

  private transitions(previous: QuestLog, next: QuestLog): void {
    for (const { type, questId } of questLogChanges(previous, next)) {
      if (type === "accepted") this.resolve("accept", questId);
      if (type === "removed") this.resolve("abandon", questId);
      this.emit(type, "quest_log", questId);
    }
  }
}
