import { GameOpcode } from "#wow/protocol/opcodes";
import {
  buildQuestQuery,
  type QuestQueryResponse,
} from "#wow/protocol/quest-query";
import type { QuestLog } from "#wow/quest-slots";

export type QuestQuery =
  | { questId: number; status: "unanswered"; sentAt: number }
  | {
      questId: number;
      status: "known";
      receivedAt: number;
      data: QuestQueryResponse;
    };

export type QuestQueryDeps = {
  send: (opcode: number, body?: Uint8Array) => void;
  now: () => number;
};

export class QuestQueries {
  readonly entries = new Map<number, QuestQuery>();
  private readonly deps: QuestQueryDeps;

  constructor(deps: QuestQueryDeps) {
    this.deps = deps;
  }

  request(questId: number): void {
    this.deps.send(GameOpcode.CMSG_QUEST_QUERY, buildQuestQuery(questId));
    if (this.entries.get(questId)?.status !== "known")
      this.entries.set(questId, {
        questId,
        status: "unanswered",
        sentAt: this.deps.now(),
      });
  }

  requestLogged(log: QuestLog): void {
    for (const { questId } of log.slots)
      if (questId && !this.entries.has(questId)) this.request(questId);
  }

  receive(data: QuestQueryResponse): void {
    this.entries.set(data.questId, {
      questId: data.questId,
      status: "known",
      receivedAt: this.deps.now(),
      data,
    });
  }
}
