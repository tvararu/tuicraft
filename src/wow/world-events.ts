import { Emitter } from "lib/emitter";
import type { ChatMessage, DuelEvent, GroupEvent } from "wow/client";
import type { CombatEvent } from "wow/combat";
import type { ControlEvent } from "wow/control";
import type { CycleEvent } from "wow/encounter-cycle";
import type { EntityEvent } from "wow/entity-store";
import type { FriendEvent } from "wow/friend-store";
import type { GuildEvent } from "wow/guild-store";
import type { IgnoreEvent } from "wow/ignore-store";
import type { QuestEvent } from "wow/quests";
import type { RecoveryEvent } from "wow/recovery";
import type { RemoteMotionEvent } from "wow/remote-motion";
import type { RewardsEvent } from "wow/rewards";
import type { TacticsEvent } from "wow/tactics";

export type WorldEvents = {
  message: Emitter<[ChatMessage]>;
  group: Emitter<[GroupEvent]>;
  entity: Emitter<[EntityEvent]>;
  packetError: Emitter<[number, Error]>;
  friend: Emitter<[FriendEvent]>;
  ignore: Emitter<[IgnoreEvent]>;
  guild: Emitter<[GuildEvent]>;
  duel: Emitter<[DuelEvent]>;
  control: Emitter<[ControlEvent]>;
  combat: Emitter<[CombatEvent]>;
  tactics: Emitter<[TacticsEvent]>;
  recovery: Emitter<[RecoveryEvent]>;
  quest: Emitter<[QuestEvent]>;
  rewards: Emitter<[RewardsEvent]>;
  cycle: Emitter<[CycleEvent]>;
  remoteMotion: Emitter<[RemoteMotionEvent]>;
};

export function createWorldEvents(
  report?: (error: unknown) => void,
): WorldEvents {
  return {
    message: new Emitter(report),
    group: new Emitter(report),
    entity: new Emitter(report),
    packetError: new Emitter(),
    friend: new Emitter(report),
    ignore: new Emitter(report),
    guild: new Emitter(report),
    duel: new Emitter(report),
    control: new Emitter(report),
    combat: new Emitter(report),
    tactics: new Emitter(report),
    recovery: new Emitter(report),
    quest: new Emitter(report),
    rewards: new Emitter(report),
    cycle: new Emitter(report),
    remoteMotion: new Emitter(report),
  };
}

export function clearWorldEvents(events: WorldEvents): void {
  for (const emitter of Object.values(events)) emitter.clear();
}
