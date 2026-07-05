import type { PacketReader } from "wow/protocol/packet";
import { GameOpcode } from "wow/protocol/opcodes";
import {
  parseSpellStart,
  parseSpellGo,
  parseCastFailed,
  parseSpellFailure,
  parseInitialSpells,
  parseSpellCooldown,
  parseCooldownEvent,
  parseAuraUpdate,
  parseSpellNonMeleeDamage,
  parseSpellHealLog,
} from "wow/protocol/spells";
import {
  parseAttackStart,
  parseAttackStop,
  parseAttackerStateUpdate,
  parseLootResponse,
  parseItemPushResult,
  parseLootMoneyNotify,
  parseXpGain,
  parseLevelUp,
  parseHealthUpdate,
  parsePowerUpdate,
  parseCorpseQueryResponse,
  parseDeathReleaseLoc,
  parseResurrectRequest,
  parseItemQueryResponse,
  buildItemQuery,
} from "wow/protocol/combat";
import { sendPacket, selfGuid } from "wow/world-handlers";
import type { WorldConn } from "wow/client";

export type CombatEvent =
  | { type: "aggro"; guid: bigint; name: string }
  | { type: "melee_start"; attacker: string; victim: string }
  | { type: "melee_stop"; attacker: string; victim: string; dead: boolean }
  | {
      type: "damage";
      kind: "melee" | "spell";
      source: string;
      target: string;
      amount: number;
      crit: boolean;
      miss: boolean;
      spellId?: number;
      periodic?: boolean;
    }
  | {
      type: "heal";
      target: string;
      amount: number;
      crit: boolean;
      spellId: number;
    }
  | { type: "cast_started"; spellId: number; castTimeMs: number }
  | { type: "cast_go"; spellId: number; target: string; powerLeft?: number }
  | {
      type: "cast_failed";
      spellId: number;
      result: number;
      resultName: string;
    }
  | { type: "spellbook"; spells: number[] }
  | {
      type: "aura";
      unit: string;
      spellId: number;
      applied: boolean;
      timeLeftMs?: number;
    }
  | { type: "loot_window"; gold: number; items: LootWindowItem[] }
  | { type: "loot_error"; error: number }
  | {
      type: "loot_item";
      itemId: number;
      name?: string;
      count: number;
      total: number;
    }
  | { type: "loot_money"; copper: number }
  | { type: "xp"; amount: number; kill: boolean }
  | { type: "level_up"; level: number }
  | { type: "died" }
  | { type: "release_loc"; mapId: number; x: number; y: number; z: number }
  | { type: "corpse_location"; x: number; y: number; z: number }
  | { type: "reclaim_delay"; ms: number }
  | { type: "resurrect_offer"; from: string }
  | {
      type: "swing_error";
      error: "not_in_range" | "bad_facing" | "dead_target" | "cant_attack";
    };

export type LootWindowItem = {
  slot: number;
  itemId: number;
  count: number;
  name?: string;
};

export type Aura = {
  spellId: number;
  expiresAt?: number;
};

function emit(conn: WorldConn, event: CombatEvent): void {
  conn.onCombatEventInternal?.(event);
  conn.onCombatEvent?.(event);
}

function unitName(conn: WorldConn, guid: bigint): string {
  if (guid === selfGuid(conn)) return conn.selfName;
  const entity = conn.entityStore.get(guid);
  if (entity?.name) return entity.name;
  const cached = conn.nameCache.get(Number(guid & 0xffffffffn));
  return cached ?? `0x${guid.toString(16)}`;
}

export function handleAiReaction(conn: WorldConn, r: PacketReader): void {
  const guid = r.uint64LE();
  const reaction = r.uint32LE();
  if (reaction === 2) {
    emit(conn, { type: "aggro", guid, name: unitName(conn, guid) });
  }
}

export function handleAttackStart(conn: WorldConn, r: PacketReader): void {
  const { attacker, victim } = parseAttackStart(r);
  emit(conn, {
    type: "melee_start",
    attacker: unitName(conn, attacker),
    victim: unitName(conn, victim),
  });
}

export function handleAttackStop(conn: WorldConn, r: PacketReader): void {
  const { attacker, victim, dead } = parseAttackStop(r);
  emit(conn, {
    type: "melee_stop",
    attacker: unitName(conn, attacker),
    victim: victim === 0n ? "" : unitName(conn, victim),
    dead,
  });
}

const SWING_ERRORS: Record<
  number,
  "not_in_range" | "bad_facing" | "dead_target" | "cant_attack"
> = {
  [GameOpcode.SMSG_ATTACKSWING_NOTINRANGE]: "not_in_range",
  [GameOpcode.SMSG_ATTACKSWING_BADFACING]: "bad_facing",
  [GameOpcode.SMSG_ATTACKSWING_DEADTARGET]: "dead_target",
  [GameOpcode.SMSG_ATTACKSWING_CANT_ATTACK]: "cant_attack",
};

export function handleSwingError(conn: WorldConn, opcode: number): void {
  const error = SWING_ERRORS[opcode];
  if (error) emit(conn, { type: "swing_error", error });
}

export function handleAttackerStateUpdate(
  conn: WorldConn,
  r: PacketReader,
): void {
  const swing = parseAttackerStateUpdate(r);
  const entity = conn.entityStore.get(swing.victim);
  if (entity && "health" in entity && swing.damage > 0) {
    conn.entityStore.update(swing.victim, {
      health: Math.max(0, entity.health - swing.damage),
    });
  }
  emit(conn, {
    type: "damage",
    kind: "melee",
    source: unitName(conn, swing.attacker),
    target: unitName(conn, swing.victim),
    amount: swing.damage,
    crit: swing.crit,
    miss: swing.miss,
  });
}

export function handleSpellStart(conn: WorldConn, r: PacketReader): void {
  const start = parseSpellStart(r);
  if (start.caster !== selfGuid(conn)) return;
  emit(conn, {
    type: "cast_started",
    spellId: start.spellId,
    castTimeMs: start.castTimeMs,
  });
}

export function handleSpellGo(conn: WorldConn, r: PacketReader): void {
  const go = parseSpellGo(r);
  if (go.caster !== selfGuid(conn)) return;
  const target = go.hits[0] ?? go.target;
  emit(conn, {
    type: "cast_go",
    spellId: go.spellId,
    target: target ? unitName(conn, target) : "",
    powerLeft: go.powerLeft,
  });
}

export function handleCastFailed(conn: WorldConn, r: PacketReader): void {
  const failed = parseCastFailed(r);
  emit(conn, {
    type: "cast_failed",
    spellId: failed.spellId,
    result: failed.result,
    resultName: failed.resultName,
  });
}

export function handleSpellFailure(conn: WorldConn, r: PacketReader): void {
  const failure = parseSpellFailure(r);
  if (failure.caster !== selfGuid(conn)) return;
  emit(conn, {
    type: "cast_failed",
    spellId: failure.spellId,
    result: failure.result,
    resultName: "INTERRUPTED",
  });
}

export function handleInitialSpells(conn: WorldConn, r: PacketReader): void {
  const parsed = parseInitialSpells(r);
  conn.spellbook = new Set(parsed.spells);
  const now = conn.ticks();
  for (const cd of parsed.cooldowns) {
    const ms = cd.cooldownMs || cd.categoryCooldownMs;
    if (ms > 0 && ms < 0x80000000) conn.cooldowns.set(cd.spellId, now + ms);
  }
  emit(conn, { type: "spellbook", spells: parsed.spells });
}

export function handleSpellCooldownList(
  conn: WorldConn,
  r: PacketReader,
): void {
  const parsed = parseSpellCooldown(r);
  const now = conn.ticks();
  for (const entry of parsed.entries) {
    conn.cooldowns.set(entry.spellId, now + entry.cooldownMs);
  }
}

export function handleCooldownEvent(r: PacketReader): void {
  parseCooldownEvent(r);
}

export function handleClearCooldown(conn: WorldConn, r: PacketReader): void {
  const spellId = r.uint32LE();
  conn.cooldowns.delete(spellId);
}

export function handleAuraUpdatePacket(
  conn: WorldConn,
  r: PacketReader,
  all: boolean,
): void {
  const update = parseAuraUpdate(r, all);
  let slots = conn.auras.get(update.unit);
  if (!slots) {
    slots = new Map();
    conn.auras.set(update.unit, slots);
  }
  const now = conn.ticks();
  const interesting =
    update.unit === selfGuid(conn) || update.unit === conn.currentTarget;
  for (const aura of update.auras) {
    if (aura.spellId === 0) {
      const previous = slots.get(aura.slot);
      slots.delete(aura.slot);
      if (interesting && previous) {
        emit(conn, {
          type: "aura",
          unit: unitName(conn, update.unit),
          spellId: previous.spellId,
          applied: false,
        });
      }
      continue;
    }
    slots.set(aura.slot, {
      spellId: aura.spellId,
      expiresAt:
        aura.timeLeftMs !== undefined ? now + aura.timeLeftMs : undefined,
    });
    if (interesting) {
      emit(conn, {
        type: "aura",
        unit: unitName(conn, update.unit),
        spellId: aura.spellId,
        applied: true,
        timeLeftMs: aura.timeLeftMs,
      });
    }
  }
}

function ensureItemName(conn: WorldConn, entry: number): string | undefined {
  const cached = conn.itemNameCache.get(entry);
  if (cached) return cached;
  const key = `item:${entry}`;
  if (!conn.pendingNameQueries.has(key)) {
    conn.pendingNameQueries.add(key);
    sendPacket(conn, GameOpcode.CMSG_ITEM_QUERY_SINGLE, buildItemQuery(entry));
  }
  return undefined;
}

export function handleLootResponse(conn: WorldConn, r: PacketReader): void {
  const loot = parseLootResponse(r);
  if (loot.lootType === 0) {
    conn.pendingLoot = undefined;
    emit(conn, { type: "loot_error", error: loot.lootError ?? 0 });
    return;
  }
  conn.pendingLoot = loot;
  emit(conn, {
    type: "loot_window",
    gold: loot.gold,
    items: loot.items.map((item) => ({
      slot: item.slot,
      itemId: item.itemId,
      count: item.count,
      name: ensureItemName(conn, item.itemId),
    })),
  });
}

export function handleItemPushResult(conn: WorldConn, r: PacketReader): void {
  const push = parseItemPushResult(r);
  if (push.player !== selfGuid(conn)) return;
  emit(conn, {
    type: "loot_item",
    itemId: push.itemId,
    name: conn.itemNameCache.get(push.itemId),
    count: push.count,
    total: push.totalCount,
  });
}

export function handleLootMoneyNotify(conn: WorldConn, r: PacketReader): void {
  const { copper } = parseLootMoneyNotify(r);
  emit(conn, { type: "loot_money", copper });
}

export function handleItemQueryResponse(
  conn: WorldConn,
  r: PacketReader,
): void {
  const info = parseItemQueryResponse(r);
  if (!info) return;
  conn.pendingNameQueries.delete(`item:${info.entry}`);
  conn.itemNameCache.set(info.entry, info.name);
}

export function handleXpGain(conn: WorldConn, r: PacketReader): void {
  const xp = parseXpGain(r);
  emit(conn, { type: "xp", amount: xp.totalXp, kill: xp.kill });
}

export function handleLevelUp(conn: WorldConn, r: PacketReader): void {
  const info = parseLevelUp(r);
  emit(conn, { type: "level_up", level: info.level });
}

export function handleSpellDamageLog(conn: WorldConn, r: PacketReader): void {
  const dmg = parseSpellNonMeleeDamage(r);
  const entity = conn.entityStore.get(dmg.target);
  if (entity && "health" in entity && dmg.damage > 0) {
    conn.entityStore.update(dmg.target, {
      health: Math.max(0, entity.health - dmg.damage),
    });
  }
  emit(conn, {
    type: "damage",
    kind: "spell",
    source: unitName(conn, dmg.caster),
    target: unitName(conn, dmg.target),
    amount: dmg.damage,
    crit: dmg.crit,
    miss: false,
    spellId: dmg.spellId,
    periodic: dmg.periodic,
  });
}

export function handleSpellHealLogPacket(
  conn: WorldConn,
  r: PacketReader,
): void {
  const heal = parseSpellHealLog(r);
  emit(conn, {
    type: "heal",
    target: unitName(conn, heal.target),
    amount: heal.amount,
    crit: heal.crit,
    spellId: heal.spellId,
  });
}

export function handleHealthUpdate(conn: WorldConn, r: PacketReader): void {
  const { unit, health } = parseHealthUpdate(r);
  conn.entityStore.update(unit, { health });
  if (unit === selfGuid(conn) && health === 0) {
    emit(conn, { type: "died" });
  }
}

export function handlePowerUpdate(conn: WorldConn, r: PacketReader): void {
  const { unit, powerType, amount } = parsePowerUpdate(r);
  const entity = conn.entityStore.get(unit);
  if (entity && "power" in entity) {
    const power = [...entity.power];
    if (powerType < power.length) power[powerType] = amount;
    conn.entityStore.update(unit, { power });
  }
}

export function handleDeathReleaseLoc(conn: WorldConn, r: PacketReader): void {
  const loc = parseDeathReleaseLoc(r);
  emit(conn, { type: "release_loc", ...loc });
}

export function handleCorpseQueryResponse(
  conn: WorldConn,
  r: PacketReader,
): void {
  const corpse = parseCorpseQueryResponse(r);
  if (corpse.found && corpse.x !== undefined) {
    emit(conn, {
      type: "corpse_location",
      x: corpse.x,
      y: corpse.y!,
      z: corpse.z!,
    });
  }
}

export function handleCorpseReclaimDelay(
  conn: WorldConn,
  r: PacketReader,
): void {
  emit(conn, { type: "reclaim_delay", ms: r.uint32LE() });
}

export function handleResurrectRequest(conn: WorldConn, r: PacketReader): void {
  const req = parseResurrectRequest(r);
  conn.pendingResurrector = req.resurrector;
  emit(conn, { type: "resurrect_offer", from: req.name });
}
