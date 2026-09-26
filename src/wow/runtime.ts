import type { Unsubscribe } from "lib/emitter";
import type { ClientConfig, WorldConn } from "wow/client";
import { CombatRuntime } from "wow/combat";
import { CombatActions } from "wow/combat-actions";
import { ControlRuntime } from "wow/control";
import { EncounterCycleRuntime } from "wow/encounter-cycle";
import type { EntityLookup } from "wow/entity-store";
import {
  type FactionTemplateCatalog,
  loadFactionTemplates,
} from "wow/faction-template";
import { type JevSelect, selectJevAction } from "wow/jev";
import { createFaultSelect, faultMarker, parseJevFault } from "wow/jev-fault";
import {
  createNavigation,
  type Navigation,
  type NavPoint,
} from "wow/navigation";
import { observedTargetPosition } from "wow/observed-target";
import { ObjectType } from "wow/protocol/entity-fields";
import { QuestRuntime } from "wow/quests";
import { RecoveryRuntime } from "wow/recovery";
import { RewardsRuntime } from "wow/rewards";
import { loadSpellCatalog } from "wow/spell-catalog";
import { TacticsLoop } from "wow/tactics";
import { selfGuid, sendPacket } from "wow/world-handlers";

export type Runtimes = {
  control: ControlRuntime;
  combat: CombatRuntime;
  tactics: TacticsLoop;
  recovery: RecoveryRuntime;
  quests: QuestRuntime;
  rewards: RewardsRuntime;
  cycle: EncounterCycleRuntime;
  prepareCatalog: () => Promise<void>;
  navigation: () => Navigation;
  observedTarget: (guid: bigint) => NavPoint;
  halt: () => void;
  override: () => void;
  dispose: (sendStop: boolean) => void;
};

type LazyState = {
  disposed: boolean;
  catalogPromise?: Promise<void>;
  factions?: FactionTemplateCatalog;
  factionPromise?: Promise<void>;
  navigation?: Navigation;
};

type RuntimeParts = {
  control: ControlRuntime;
  combat: CombatRuntime;
  tactics: TacticsLoop;
  recovery: RecoveryRuntime;
  quests: QuestRuntime;
  rewards: RewardsRuntime;
  cycle: EncounterCycleRuntime;
};

function createControl(
  conn: WorldConn,
  getNavigation: () => Navigation,
): ControlRuntime {
  return new ControlRuntime({
    send: (opcode, body) => sendPacket(conn, opcode, body ?? new Uint8Array()),
    ticks: () => Date.now() - conn.startTime,
    now: () => Date.now(),
    selfGuid: () => selfGuid(conn),
    findHeight: (mapId, x, y, from) => {
      let height: number | undefined;
      try {
        height = getNavigation().height(mapId, x, y, from);
      } catch {
        height = undefined;
      }
      return height;
    },
    isPathClear: (mapId, from, to) => {
      try {
        return getNavigation().clear(mapId, from, to);
      } catch {
        return false;
      }
    },
  });
}

function loadCatalog(
  config: ClientConfig,
  lazy: LazyState,
  combat: CombatRuntime,
): Promise<void> {
  if (!config.spellDataDir)
    return Promise.reject(new Error("missing_spell_data"));
  lazy.catalogPromise ??= loadSpellCatalog(config.spellDataDir).then(
    (catalog) => {
      if (!lazy.disposed) combat.setCatalog(catalog);
    },
  );
  return lazy.catalogPromise;
}

function loadFactions(config: ClientConfig, lazy: LazyState): Promise<void> {
  if (!config.spellDataDir)
    return Promise.reject(new Error("missing_spell_data"));
  lazy.factionPromise ??= loadFactionTemplates(config.spellDataDir).then(
    (data) => {
      if (!lazy.disposed) lazy.factions = data;
    },
  );
  return lazy.factionPromise;
}

function loadNavigation(config: ClientConfig, lazy: LazyState): Navigation {
  if (!(config.navigationDataDir && config.navigationLibrary))
    throw new Error("missing_navigation");
  lazy.navigation ??= createNavigation({
    dataPath: config.navigationDataDir,
    libraryPath: config.navigationLibrary,
  });
  return lazy.navigation;
}

function createTactics(
  conn: WorldConn,
  config: ClientConfig,
  hooks: {
    actions: CombatActions;
    prepare: (signal: AbortSignal) => Promise<void>;
    halt: () => void;
  },
): TacticsLoop {
  const { actions } = hooks;
  const fault = parseJevFault(config.jevFault);
  const baseSelect: JevSelect = (request, options) =>
    selectJevAction(request, {
      ...options,
      endpointUrl: config.jevEndpointUrl,
    });
  const select = fault ? createFaultSelect(fault, baseSelect) : baseSelect;
  return new TacticsLoop({
    apiKey: config.jevApiKey,
    fault: fault && faultMarker(fault),
    characterClass: () => conn.selfClass,
    select,
    prepare: (_context, signal) => hooks.prepare(signal),
    activate: (context) => actions.activate(context),
    observe: (context) => actions.observe(context),
    execute: (id, context) => actions.execute(id, context),
    halt: hooks.halt,
  });
}

function wireEvents(conn: WorldConn, parts: RuntimeParts): Unsubscribe {
  const { control, combat, recovery, quests, rewards, cycle, tactics } = parts;
  const { events } = conn;
  const detach = [
    control.onEvent((event) => {
      events.control.emit(event);
      cycle.observeControl(event);
    }),
    combat.onEvent((event) => events.combat.emit(event)),
    tactics.onEvent((event) => events.tactics.emit(event)),
    recovery.onEvent((event) => {
      if (
        event.type === "recovery_invalidated" ||
        (event.type === "life_observed" &&
          (event.state.life === "dead" || event.state.life === "ghost"))
      ) {
        tactics.stop(`self_${event.state.life}`);
      }
      events.recovery.emit(event);
      cycle.observeRecovery(event);
    }),
    quests.onEvent((event) => events.quest.emit(event)),
    rewards.onEvent((event) => {
      events.rewards.emit(event);
      cycle.observeRewards(event);
    }),
    cycle.onEvent((event) => events.cycle.emit(event)),
  ];
  return () => {
    for (const off of detach) off();
  };
}

function findObservedTarget(
  conn: WorldConn,
  parts: Pick<RuntimeParts, "control" | "combat">,
  guid: bigint,
): NavPoint {
  const entity = conn.entityStore.get(guid);
  if (!entity || guid === selfGuid(conn))
    throw new Error("target_not_observed");
  const self = parts.control.snapshot().pose;
  if (!self) throw new Error("no_pose");
  const unit =
    entity.objectType === ObjectType.UNIT ||
    entity.objectType === ObjectType.PLAYER
      ? parts.combat.unit(guid)
      : undefined;
  return observedTargetPosition(entity, unit, self.mapId);
}

function disposeParts(
  parts: RuntimeParts,
  lazy: LazyState,
  options: { sendStop: boolean; halt: () => void; unwire: Unsubscribe },
): void {
  const { control, combat, tactics, recovery, quests, rewards, cycle } = parts;
  options.unwire();
  if (options.sendStop) options.halt();
  lazy.disposed = true;
  control.dispose();
  tactics.dispose();
  recovery.dispose();
  quests.dispose();
  rewards.dispose();
  combat.dispose();
  cycle.dispose();
  lazy.navigation?.close();
}

type RuntimeDeps = {
  send: (opcode: number, body?: Uint8Array) => void;
  now: () => number;
  selfGuid: () => bigint;
  getEntity: EntityLookup;
};

function createSupportRuntimes(
  conn: WorldConn,
  runtimeDeps: RuntimeDeps,
  parts: Pick<RuntimeParts, "control" | "tactics">,
): Pick<RuntimeParts, "recovery" | "quests" | "rewards" | "cycle"> {
  const { control, tactics } = parts;
  const recovery = new RecoveryRuntime({
    ...runtimeDeps,
    pose: () => control.snapshot().pose,
  });
  conn.recovery = recovery;
  const quests = new QuestRuntime(runtimeDeps);
  conn.quests = quests;
  const rewards = new RewardsRuntime(runtimeDeps);
  conn.rewards = rewards;
  const cycle = new EncounterCycleRuntime({
    tactics,
    rewards,
    recovery,
    control,
    now: runtimeDeps.now,
  });
  conn.cycle = cycle;
  return { recovery, quests, rewards, cycle };
}

function createCombat(
  conn: WorldConn,
  runtimeDeps: RuntimeDeps,
  lazy: LazyState,
  control: ControlRuntime,
): { combat: CombatRuntime; actions: CombatActions } {
  const combat = new CombatRuntime({
    ...runtimeDeps,
    selectedGuid: () => control.snapshot().target,
    selfPose: () => control.snapshot().pose,
    selfServerPose: () => control.snapshot().serverPose,
  });
  conn.combat = combat;
  const actions = new CombatActions({
    combat,
    control,
    entity: (guid) => conn.entityStore.get(guid),
    factions: () => lazy.factions,
    now: () => Date.now(),
  });
  return { combat, actions };
}

export function createRuntimes(
  conn: WorldConn,
  config: ClientConfig,
): Runtimes {
  const lazy: LazyState = { disposed: false };
  const getNavigation = (): Navigation => loadNavigation(config, lazy);
  conn.control = createControl(conn, getNavigation);

  const control = conn.control;
  const runtimeDeps: RuntimeDeps = {
    send: (opcode, body) => sendPacket(conn, opcode, body ?? new Uint8Array()),
    now: () => Date.now(),
    selfGuid: () => selfGuid(conn),
    getEntity: (guid) => conn.entityStore.get(guid),
  };
  const { combat, actions } = createCombat(conn, runtimeDeps, lazy, control);
  const prepareCatalog = (): Promise<void> => loadCatalog(config, lazy, combat);
  function rawHalt(): void {
    if (lazy.disposed) return;
    control.setMode("none");
    control.halt();
    combat.halt();
  }
  const tactics = createTactics(conn, config, {
    actions,
    async prepare(signal) {
      signal.throwIfAborted();
      await prepareCatalog();
      signal.throwIfAborted();
      await loadFactions(config, lazy);
      signal.throwIfAborted();
    },
    halt: rawHalt,
  });
  conn.tactics = tactics;
  const parts = {
    control,
    combat,
    tactics,
    ...createSupportRuntimes(conn, runtimeDeps, { control, tactics }),
  };
  const unwire = wireEvents(conn, parts);
  const { cycle } = parts;
  return {
    ...parts,
    prepareCatalog,
    navigation: getNavigation,
    observedTarget: (guid) => findObservedTarget(conn, parts, guid),
    halt: rawHalt,
    override(): void {
      cycle.stop("manual_override");
      tactics.stop("manual_override");
      rawHalt();
    },
    dispose(sendStop: boolean): void {
      if (lazy.disposed) return;
      disposeParts(parts, lazy, { sendStop, halt: rawHalt, unwire });
    },
  };
}
