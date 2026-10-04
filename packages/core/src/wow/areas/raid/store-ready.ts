import type { RaidGroup } from "#wow/areas/raid/protocol";

export type ReadyAnswer = "ready" | "not_ready" | "offline";

export type ReadyCheck = {
  id: number;
  names: ReadonlyMap<bigint, string>;
  silent: readonly string[] | undefined;
  initiator: bigint;
  startedAt: number;
  answers: ReadonlyMap<bigint, ReadyAnswer>;
  ownAnswer: ReadyAnswer | undefined;
  finishedAt: number | undefined;
  seen: boolean;
};

export type ReadyEvent =
  | { type: "ready_check_started"; initiator: bigint; name: string }
  | {
      type: "ready_check_answer";
      guid: bigint;
      name: string;
      answer: ReadyAnswer;
    }
  | {
      type: "ready_check_finished";
      ready: number;
      notReady: readonly string[];
      offline: number;
      pending: number;
    };

const ASSISTANT_FLAG = 0x01;
const STATUS_ONLINE = 0x01;

function nameOf(group: RaidGroup | undefined, guid: bigint): string {
  return group?.members.find((member) => member.guid === guid)?.name ?? "";
}

export function isOnline(status: number): boolean {
  return (status & STATUS_ONLINE) !== 0;
}

export function seesAnswers(
  group: RaidGroup | undefined,
  check: Pick<ReadyCheck, "initiator">,
  selfGuid: bigint,
): boolean {
  if (check.initiator === selfGuid) return true;
  if (group?.leader === selfGuid) return true;
  const me = group?.members.find((member) => member.guid === selfGuid);
  const flags = me ? me.flags : (group?.self.flags ?? 0);
  return Math.floor(flags / ASSISTANT_FLAG) % 2 === 1;
}

export function pendingGuids(
  group: RaidGroup | undefined,
  check: ReadyCheck,
): readonly bigint[] {
  return (group?.members ?? [])
    .filter(
      (member) =>
        member.guid !== check.initiator &&
        isOnline(member.status) &&
        !check.answers.has(member.guid),
    )
    .map((member) => member.guid);
}

function summary(
  group: RaidGroup | undefined,
  check: ReadyCheck,
): Extract<ReadyEvent, { type: "ready_check_finished" }> {
  const notReady: string[] = [];
  let ready = 0;
  let offline = 0;
  for (const [guid, answer] of check.answers) {
    if (answer === "ready") ready++;
    else if (answer === "offline") offline++;
    else notReady.push(nameOf(group, guid));
  }
  return {
    notReady,
    offline,
    pending: pendingGuids(group, check).length,
    ready,
    type: "ready_check_finished",
  };
}

function answerFor(ready: boolean, status: number): ReadyAnswer {
  if (ready) return "ready";
  if (isOnline(status)) return "not_ready";
  return "offline";
}

export class ReadyStore {
  private check: ReadyCheck | undefined;
  private lastId = 0;

  current(): ReadyCheck | undefined {
    return this.check;
  }

  start(
    group: RaidGroup | undefined,
    initiator: bigint,
    now: number,
    selfGuid: bigint,
  ): ReadyEvent {
    this.lastId += 1;
    const draft = { initiator };
    this.check = {
      answers: new Map(),
      finishedAt: undefined,
      id: this.lastId,
      initiator,
      names: new Map(
        (group?.members ?? []).map((member) => [member.guid, member.name]),
      ),
      ownAnswer: undefined,
      seen: seesAnswers(group, draft, selfGuid),
      silent: undefined,
      startedAt: now,
    };
    return {
      initiator,
      name: nameOf(group, initiator),
      type: "ready_check_started",
    };
  }

  confirm(
    group: RaidGroup | undefined,
    guid: bigint,
    ready: boolean,
  ): ReadyEvent | undefined {
    const check = this.check;
    const member = group?.members.find((entry) => entry.guid === guid);
    if (!check || check.finishedAt !== undefined || !member) return undefined;
    const answer = answerFor(ready, member.status);
    this.check = {
      ...check,
      answers: new Map(check.answers).set(guid, answer),
      names: new Map(check.names).set(guid, member.name),
    };
    return { answer, guid, name: member.name, type: "ready_check_answer" };
  }

  own(ready: boolean): void {
    const check = this.check;
    if (!check || check.finishedAt !== undefined) return;
    this.check = { ...check, ownAnswer: ready ? "ready" : "not_ready" };
  }

  finish(group: RaidGroup | undefined, now: number): ReadyEvent | undefined {
    const check = this.check;
    if (!check || check.finishedAt !== undefined) return undefined;
    const silent = pendingGuids(group, check).map((guid) =>
      nameOf(group, guid),
    );
    this.check = { ...check, finishedAt: now, silent };
    return summary(group, this.check);
  }

  clear(): void {
    this.check = undefined;
  }
}
