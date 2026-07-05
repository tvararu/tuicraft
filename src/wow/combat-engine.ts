import { GameOpcode } from "wow/protocol/opcodes";
import { ObjectType } from "wow/protocol/entity-fields";
import { buildCastSpell } from "wow/protocol/spells";
import {
  buildGuidBody,
  buildBigintGuidBody,
  buildRepopRequest,
  buildAutostoreLootItem,
  buildStandStateChange,
  buildResurrectResponse,
} from "wow/protocol/combat";
import { sendPacket, selfGuid } from "wow/world-handlers";
import type { CombatEvent } from "wow/combat-handlers";
import type { MovementEngine } from "wow/movement-engine";
import type { WorldConn } from "wow/client";
import type { UnitEntity, Entity } from "wow/entity-store";

export type HuntEvent =
  | { type: "hunt_started"; name: string }
  | { type: "hunt_phase"; phase: "approach" | "fight" | "loot" }
  | { type: "hunt_complete"; name: string; durationMs: number }
  | { type: "hunt_aborted"; reason: string };

export type Vitals = {
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  level: number;
  dead: boolean;
};

export type CombatEngine = {
  target(name: string): boolean;
  attack(): boolean;
  stopAttack(): void;
  cast(spellId: number, onSelf: boolean): boolean;
  loot(): boolean;
  hunt(name: string): boolean;
  releaseSpirit(): void;
  reclaimCorpse(): void;
  queryCorpse(): void;
  acceptResurrect(): void;
  sit(): void;
  stand(): void;
  spellbook(): number[];
  auras(
    unit: "self" | "target",
  ): Array<{ spellId: number; remainingMs?: number }>;
  vitals(): Vitals;
  handleEvent(event: CombatEvent): void;
  state(): string;
  dispose(): void;
};

const SPELLS = {
  SHOOT: 5019,
  SWP: [594, 589],
  SMITE: [591, 585],
  RENEW: [6074, 139],
  SHIELD: [17],
  HEAL: [2053, 2052, 2050],
  MIND_BLAST: [8092],
  WEAKENED_SOUL: 6788,
};

const PULL_RANGE = 26;
const LOOT_RANGE = 4;
const GCD_MS = 1600;
const FIGHT_TIMEOUT_MS = 60_000;
const LOOT_TIMEOUT_MS = 6_000;
const DYNFLAG_LOOTABLE = 0x1;

const UNATTACKABLE_FLAGS = 0x2 | 0x80 | 0x100 | 0x10000 | 0x2000000;

export function createCombatEngine(
  conn: WorldConn,
  movement: MovementEngine,
  emit: (event: HuntEvent) => void,
  opts: { tickMs?: number } = {},
): CombatEngine {
  const tickMs = opts.tickMs ?? 250;

  type HuntState =
    | { kind: "idle" }
    | { kind: "approach"; guid: bigint; name: string; startedAt: number }
    | {
        kind: "fight";
        guid: bigint;
        name: string;
        startedAt: number;
        fightStartedAt: number;
        opened: boolean;
        meleeFallback: boolean;
      }
    | {
        kind: "loot_approach";
        guid: bigint;
        name: string;
        startedAt: number;
      }
    | {
        kind: "looting";
        guid: bigint;
        name: string;
        startedAt: number;
        lootStartedAt: number;
      };

  let huntState: HuntState = { kind: "idle" };
  let gcdReadyAt = 0;
  let castCounter = 0;

  function self(): UnitEntity | undefined {
    const entity = conn.entityStore.get(selfGuid(conn));
    return entity && "health" in entity ? (entity as UnitEntity) : undefined;
  }

  function unit(guid: bigint): UnitEntity | undefined {
    const entity = conn.entityStore.get(guid);
    return entity && "health" in entity ? (entity as UnitEntity) : undefined;
  }

  function bestKnown(candidates: number[]): number | undefined {
    return candidates.find((id) => conn.spellbook.has(id));
  }

  function offCooldown(spellId: number): boolean {
    const readyAt = conn.cooldowns.get(spellId);
    return readyAt === undefined || conn.ticks() >= readyAt;
  }

  function hasAura(unitGuid: bigint, spellId: number): boolean {
    const slots = conn.auras.get(unitGuid);
    if (!slots) return false;
    const now = conn.ticks();
    for (const aura of slots.values()) {
      if (aura.spellId !== spellId) continue;
      if (aura.expiresAt === undefined || aura.expiresAt > now) return true;
    }
    return false;
  }

  function distanceTo(pos: { x: number; y: number; z: number }): number {
    return Math.hypot(pos.x - conn.own.x, pos.y - conn.own.y);
  }

  function faceUnit(pos: { x: number; y: number }): void {
    const heading = Math.atan2(pos.y - conn.own.y, pos.x - conn.own.x);
    const diff = Math.atan2(
      Math.sin(heading - conn.own.orientation),
      Math.cos(heading - conn.own.orientation),
    );
    if (Math.abs(diff) > 0.25) movement.face(heading);
  }

  function setSelection(guid: bigint): void {
    conn.currentTarget = guid;
    sendPacket(conn, GameOpcode.CMSG_SET_SELECTION, buildBigintGuidBody(guid));
  }

  function sendCast(spellId: number, target: bigint | "self"): void {
    castCounter = (castCounter + 1) & 0xff;
    const body =
      target === "self"
        ? buildCastSpell(castCounter, spellId, { kind: "self" })
        : buildCastSpell(castCounter, spellId, {
            kind: "unit",
            guidLow: Number(target & 0xffffffffn),
            guidHigh: Number((target >> 32n) & 0xffffffffn),
          });
    sendPacket(conn, GameOpcode.CMSG_CAST_SPELL, body);
    if (spellId !== SPELLS.SHOOT) gcdReadyAt = conn.ticks() + GCD_MS;
  }

  function gcdReady(): boolean {
    return conn.ticks() >= gcdReadyAt;
  }

  function findByName(name: string): UnitEntity | undefined {
    const lower = name.toLowerCase();
    const candidates = conn.entityStore
      .all()
      .filter(
        (e): e is UnitEntity =>
          (e.objectType === ObjectType.UNIT ||
            e.objectType === ObjectType.PLAYER) &&
          "health" in e &&
          e.name?.toLowerCase() === lower &&
          e.position !== undefined,
      )
      .filter((e) => e.health > 0 && (e.unitFlags & UNATTACKABLE_FLAGS) === 0);
    candidates.sort(
      (a, b) => distanceTo(a.position!) - distanceTo(b.position!),
    );
    return candidates[0];
  }

  function abort(reason: string): void {
    if (huntState.kind === "idle") return;
    huntState = { kind: "idle" };
    movement.stop();
    sendPacket(conn, GameOpcode.CMSG_ATTACKSTOP);
    emit({ type: "hunt_aborted", reason });
  }

  function startWand(guid: bigint): void {
    if (conn.spellbook.has(SPELLS.SHOOT)) sendCast(SPELLS.SHOOT, guid);
  }

  function tickFight(state: HuntState & { kind: "fight" }): void {
    const me = self();
    const target = unit(state.guid);
    const now = conn.ticks();

    if (!target || target.health <= 0) {
      huntState = {
        kind: "loot_approach",
        guid: state.guid,
        name: state.name,
        startedAt: state.startedAt,
      };
      emit({ type: "hunt_phase", phase: "loot" });
      return;
    }
    if (now - state.fightStartedAt > FIGHT_TIMEOUT_MS) {
      abort("fight_timeout");
      return;
    }
    if (!target.position) return;

    faceUnit(target.position);

    const hpPct = me && me.maxHealth > 0 ? me.health / me.maxHealth : 1;
    const mana = me?.power[0] ?? 0;

    if (hpPct < 0.25) {
      const shield = bestKnown(SPELLS.SHIELD);
      if (
        shield &&
        gcdReady() &&
        !hasAura(selfGuid(conn), SPELLS.WEAKENED_SOUL) &&
        mana >= 48
      ) {
        sendCast(shield, "self");
        startWand(state.guid);
        return;
      }
    }

    if (hpPct < 0.65 && gcdReady()) {
      const renew = bestKnown(SPELLS.RENEW);
      if (renew && !hasAura(selfGuid(conn), renew) && mana >= 36) {
        sendCast(renew, "self");
        startWand(state.guid);
        return;
      }
    }

    if (!state.opened) {
      const opener = bestKnown(SPELLS.SWP);
      if (opener && gcdReady() && mana >= 46) {
        sendCast(opener, state.guid);
        state.opened = true;
        startWand(state.guid);
        return;
      }
      state.opened = true;
      startWand(state.guid);
      if (!conn.spellbook.has(SPELLS.SHOOT)) {
        state.meleeFallback = true;
        sendPacket(
          conn,
          GameOpcode.CMSG_ATTACKSWING,
          buildBigintGuidBody(state.guid),
        );
      }
      return;
    }

    const targetPct =
      target.maxHealth > 0 ? target.health / target.maxHealth : 1;
    if (targetPct < 0.4 && gcdReady()) {
      const mb = bestKnown(SPELLS.MIND_BLAST);
      if (mb && offCooldown(mb) && mana >= 36) {
        sendCast(mb, state.guid);
        startWand(state.guid);
        return;
      }
    }
  }

  function tick(): void {
    const state = huntState;
    switch (state.kind) {
      case "idle":
        return;
      case "approach": {
        const target = unit(state.guid);
        if (!target?.position || target.health <= 0) {
          abort("target_lost");
          return;
        }
        const dist = distanceTo(target.position);
        if (dist > PULL_RANGE) {
          if (movement.state().kind !== "moving") {
            movement.moveTo(
              target.position.x,
              target.position.y,
              target.position.z,
            );
          }
          return;
        }
        movement.stop();
        setSelection(state.guid);
        faceUnit(target.position);
        huntState = {
          kind: "fight",
          guid: state.guid,
          name: state.name,
          startedAt: state.startedAt,
          fightStartedAt: conn.ticks(),
          opened: false,
          meleeFallback: false,
        };
        emit({ type: "hunt_phase", phase: "fight" });
        return;
      }
      case "fight":
        tickFight(state);
        return;
      case "loot_approach": {
        const corpse = unit(state.guid);
        if (!corpse?.position) {
          finishHunt(state);
          return;
        }
        if ((corpse.dynamicFlags & DYNFLAG_LOOTABLE) === 0) {
          finishHunt(state);
          return;
        }
        const dist = distanceTo(corpse.position);
        if (dist > LOOT_RANGE) {
          if (movement.state().kind !== "moving") {
            movement.moveTo(
              corpse.position.x,
              corpse.position.y,
              corpse.position.z,
            );
          }
          return;
        }
        movement.stop();
        sendPacket(conn, GameOpcode.CMSG_LOOT, buildBigintGuidBody(state.guid));
        huntState = {
          kind: "looting",
          guid: state.guid,
          name: state.name,
          startedAt: state.startedAt,
          lootStartedAt: conn.ticks(),
        };
        return;
      }
      case "looting": {
        if (conn.pendingLoot) {
          drainLoot(state.guid);
          finishHunt(state);
          return;
        }
        if (conn.ticks() - state.lootStartedAt > LOOT_TIMEOUT_MS) {
          finishHunt(state);
        }
        return;
      }
    }
  }

  function drainLoot(corpse: bigint): void {
    const loot = conn.pendingLoot;
    if (!loot) return;
    conn.pendingLoot = undefined;
    for (const item of loot.items) {
      if (item.slotType === 0 || item.slotType === 4) {
        sendPacket(
          conn,
          GameOpcode.CMSG_AUTOSTORE_LOOT_ITEM,
          buildAutostoreLootItem(item.slot),
        );
      }
    }
    if (loot.gold > 0) sendPacket(conn, GameOpcode.CMSG_LOOT_MONEY);
    sendPacket(conn, GameOpcode.CMSG_LOOT_RELEASE, buildBigintGuidBody(corpse));
  }

  function finishHunt(
    state: HuntState & { kind: "loot_approach" | "looting" },
  ): void {
    huntState = { kind: "idle" };
    emit({
      type: "hunt_complete",
      name: state.name,
      durationMs: conn.ticks() - state.startedAt,
    });
  }

  const interval = setInterval(tick, tickMs);

  return {
    target(name) {
      const found = findByName(name);
      if (!found) return false;
      setSelection(found.guid);
      return true;
    },
    attack() {
      if (conn.currentTarget === 0n) return false;
      sendPacket(
        conn,
        GameOpcode.CMSG_ATTACKSWING,
        buildBigintGuidBody(conn.currentTarget),
      );
      return true;
    },
    stopAttack() {
      sendPacket(conn, GameOpcode.CMSG_ATTACKSTOP);
    },
    cast(spellId, onSelf) {
      if (onSelf) {
        sendCast(spellId, "self");
        return true;
      }
      if (conn.currentTarget === 0n) return false;
      const target = unit(conn.currentTarget);
      if (target?.position) faceUnit(target.position);
      sendCast(spellId, conn.currentTarget);
      return true;
    },
    loot() {
      if (conn.currentTarget === 0n) return false;
      sendPacket(
        conn,
        GameOpcode.CMSG_LOOT,
        buildBigintGuidBody(conn.currentTarget),
      );
      return true;
    },
    hunt(name) {
      const found = findByName(name);
      if (!found) return false;
      huntState = {
        kind: "approach",
        guid: found.guid,
        name: found.name ?? name,
        startedAt: conn.ticks(),
      };
      emit({ type: "hunt_started", name: found.name ?? name });
      emit({ type: "hunt_phase", phase: "approach" });
      return true;
    },
    releaseSpirit() {
      sendPacket(conn, GameOpcode.CMSG_REPOP_REQUEST, buildRepopRequest());
    },
    reclaimCorpse() {
      const corpse = conn.entityStore
        .all()
        .find((e: Entity) => e.objectType === ObjectType.CORPSE);
      sendPacket(
        conn,
        GameOpcode.CMSG_RECLAIM_CORPSE,
        corpse
          ? buildBigintGuidBody(corpse.guid)
          : buildGuidBody(conn.selfGuidLow, conn.selfGuidHigh),
      );
    },
    queryCorpse() {
      sendPacket(conn, GameOpcode.MSG_CORPSE_QUERY);
    },
    acceptResurrect() {
      if (conn.pendingResurrector === undefined) return;
      sendPacket(
        conn,
        GameOpcode.CMSG_RESURRECT_RESPONSE,
        buildResurrectResponse(conn.pendingResurrector, true),
      );
      conn.pendingResurrector = undefined;
    },
    sit() {
      sendPacket(
        conn,
        GameOpcode.CMSG_STANDSTATECHANGE,
        buildStandStateChange(1),
      );
    },
    stand() {
      sendPacket(
        conn,
        GameOpcode.CMSG_STANDSTATECHANGE,
        buildStandStateChange(0),
      );
    },
    spellbook() {
      return [...conn.spellbook].sort((a, b) => a - b);
    },
    auras(unitKind) {
      const guid = unitKind === "self" ? selfGuid(conn) : conn.currentTarget;
      const slots = conn.auras.get(guid);
      if (!slots) return [];
      const now = conn.ticks();
      return [...slots.values()].map((aura) => ({
        spellId: aura.spellId,
        remainingMs:
          aura.expiresAt !== undefined
            ? Math.max(0, aura.expiresAt - now)
            : undefined,
      }));
    },
    vitals() {
      const me = self();
      return {
        health: me?.health ?? 0,
        maxHealth: me?.maxHealth ?? 0,
        mana: me?.power[0] ?? 0,
        maxMana: me?.maxPower[0] ?? 0,
        level: me?.level ?? 0,
        dead: (me?.health ?? 1) <= 0,
      };
    },
    handleEvent(event) {
      if (event.type === "died") {
        if (huntState.kind !== "idle") abort("died");
        return;
      }
      if (huntState.kind !== "fight") return;
      const state = huntState;
      if (event.type === "cast_failed") {
        switch (event.resultName) {
          case "OUT_OF_RANGE": {
            const target = unit(state.guid);
            if (target?.position) {
              movement.moveTo(
                target.position.x,
                target.position.y,
                target.position.z,
              );
              huntState = {
                kind: "approach",
                guid: state.guid,
                name: state.name,
                startedAt: state.startedAt,
              };
              emit({ type: "hunt_phase", phase: "approach" });
            }
            break;
          }
          case "UNIT_NOT_INFRONT": {
            const target = unit(state.guid);
            if (target?.position) faceUnit(target.position);
            break;
          }
          case "MOVING":
            movement.stop();
            break;
          case "TARGETS_DEAD":
            huntState = {
              kind: "loot_approach",
              guid: state.guid,
              name: state.name,
              startedAt: state.startedAt,
            };
            emit({ type: "hunt_phase", phase: "loot" });
            break;
          case "NO_POWER":
            startWand(state.guid);
            break;
        }
        return;
      }
      if (event.type === "swing_error" && event.error === "dead_target") {
        huntState = {
          kind: "loot_approach",
          guid: state.guid,
          name: state.name,
          startedAt: state.startedAt,
        };
        emit({ type: "hunt_phase", phase: "loot" });
      }
    },
    state() {
      return huntState.kind;
    },
    dispose() {
      clearInterval(interval);
    },
  };
}
