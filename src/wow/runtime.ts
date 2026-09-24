import type { ClientConfig, WorldConn } from "wow/client";
import { ControlRuntime } from "wow/control";
import { CombatRuntime } from "wow/combat";
import { loadSpellCatalog } from "wow/spell-catalog";
import { TacticsLoop } from "wow/tactics";
import { CombatActions } from "wow/combat-actions";
import { selectJevAction, type JevSelect } from "wow/jev";
import { createFaultSelect, faultMarker, parseJevFault } from "wow/jev-fault";
import {
  loadFactionTemplates,
  type FactionTemplateCatalog,
} from "wow/faction-template";
import {
  createNavigation,
  type Navigation,
  type NavPoint,
} from "wow/navigation";
import { RecoveryRuntime } from "wow/recovery";
import { QuestRuntime } from "wow/quests";
import { RewardsRuntime } from "wow/rewards";
import { EncounterCycleRuntime } from "wow/encounter-cycle";
import { ObjectType } from "wow/protocol/entity-fields";
import { sendPacket, selfGuid } from "wow/world-handlers";

export type Runtimes = {
  control: ControlRuntime;
  combat: CombatRuntime;
  tactics: TacticsLoop;
  recovery: RecoveryRuntime;
  quests: QuestRuntime;
  rewards: RewardsRuntime;
  cycle: EncounterCycleRuntime;
  prepareCatalog(): Promise<void>;
  navigation(): Navigation;
  observedTarget(guid: bigint): NavPoint;
  halt(): void;
  override(): void;
  dispose(sendStop: boolean): void;
};

export function createRuntimes(
  conn: WorldConn,
  config: ClientConfig,
): Runtimes {
  conn.control = new ControlRuntime({
    send: (opcode, body) => sendPacket(conn, opcode, body ?? new Uint8Array()),
    ticks: () => Date.now() - conn.startTime,
    now: () => Date.now(),
    selfGuid: () => selfGuid(conn),
    findHeight: (mapId, x, y, from) => {
      try {
        return getNavigation().height(mapId, x, y, from);
      } catch {
        return undefined;
      }
    },
    isPathClear: (mapId, from, to) => {
      try {
        return getNavigation().clear(mapId, from, to);
      } catch {
        return false;
      }
    },
  });

  const control = conn.control;
  const runtimeDeps = {
    send: (opcode: number, body?: Uint8Array) =>
      sendPacket(conn, opcode, body ?? new Uint8Array()),
    now: () => Date.now(),
    selfGuid: () => selfGuid(conn),
    getEntity: (guid: bigint) => conn.entityStore.get(guid),
  };
  const combat = new CombatRuntime({
    ...runtimeDeps,
    selectedGuid: () => control.snapshot().target,
    selfPose: () => control.snapshot().pose,
    selfServerPose: () => control.snapshot().serverPose,
  });
  conn.combat = combat;
  let catalogPromise: Promise<void> | undefined;
  let factions: FactionTemplateCatalog | undefined;
  let factionPromise: Promise<void> | undefined;
  let navigation: Navigation | undefined;
  let disposed = false;
  const actions = new CombatActions({
    combat,
    control,
    entity: (guid) => conn.entityStore.get(guid),
    factions: () => factions,
    now: () => Date.now(),
  });
  function prepareCatalog(): Promise<void> {
    if (!config.spellDataDir)
      return Promise.reject(new Error("missing_spell_data"));
    catalogPromise ??= loadSpellCatalog(config.spellDataDir).then((catalog) => {
      if (!disposed) combat.setCatalog(catalog);
    });
    return catalogPromise;
  }
  function prepareFactions(): Promise<void> {
    if (!config.spellDataDir)
      return Promise.reject(new Error("missing_spell_data"));
    factionPromise ??= loadFactionTemplates(config.spellDataDir).then(
      (data) => {
        if (!disposed) factions = data;
      },
    );
    return factionPromise;
  }
  function getNavigation(): Navigation {
    if (!config.navigationDataDir || !config.navigationLibrary)
      throw new Error("missing_navigation");
    navigation ??= createNavigation({
      dataPath: config.navigationDataDir,
      libraryPath: config.navigationLibrary,
    });
    return navigation;
  }
  function rawHalt(): void {
    if (disposed) return;
    control.setMode("none");
    control.halt();
    combat.halt();
  }
  const fault = parseJevFault(config.jevFault);
  const baseSelect: JevSelect = (request, options) =>
    selectJevAction(request, {
      ...options,
      endpointUrl: config.jevEndpointUrl,
    });
  const select = fault ? createFaultSelect(fault, baseSelect) : baseSelect;
  const tactics = new TacticsLoop({
    apiKey: config.jevApiKey,
    framing: config.framing,
    characterClass: config.characterClass,
    fault: fault && faultMarker(fault),
    select,
    async prepare(_context, signal) {
      signal.throwIfAborted();
      await prepareCatalog();
      signal.throwIfAborted();
      await prepareFactions();
      signal.throwIfAborted();
    },
    activate: (context) => actions.activate(context),
    observe: (context) => actions.observe(context),
    execute: (id, context) => actions.execute(id, context),
    halt: rawHalt,
  });
  conn.tactics = tactics;
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
  control.onEvent((event) => {
    conn.onControlEvent?.(event);
  });
  recovery.onEvent((event) => {
    if (
      event.type === "recovery_invalidated" ||
      (event.type === "life_observed" &&
        (event.state.life === "dead" || event.state.life === "ghost"))
    ) {
      tactics.stop(`self_${event.state.life}`);
    }
    conn.onRecoveryEvent?.(event);
    cycle.observeRecovery(event);
  });
  rewards.onEvent((event) => {
    conn.onRewardsEvent?.(event);
    cycle.observeRewards(event);
  });
  function observedTarget(guid: bigint): { x: number; y: number; z: number } {
    const entity = conn.entityStore.get(guid);
    if (!entity || guid === selfGuid(conn))
      throw new Error("target_not_observed");
    const self = control.snapshot().pose;
    if (!self) throw new Error("no_pose");
    const unit =
      entity.objectType === ObjectType.UNIT ||
      entity.objectType === ObjectType.PLAYER
        ? combat.unit(guid)
        : undefined;
    if (unit?.motion?.unsupportedReason)
      throw new Error(unit.motion.unsupportedReason);
    if (
      unit?.motion &&
      (Date.now() - unit.motion.observedAt < 0 ||
        Date.now() - unit.motion.observedAt > 5000)
    )
      throw new Error("target_stale");
    const position = unit?.serverPose ?? entity.position;
    if (
      !position ||
      ![position.x, position.y, position.z].every(Number.isFinite)
    )
      throw new Error("target_not_observed");
    if (position.mapId !== self.mapId) throw new Error("target_map_changed");
    return { x: position.x, y: position.y, z: position.z };
  }

  function override(): void {
    cycle.stop("manual_override");
    tactics.stop("manual_override");
    rawHalt();
  }
  function dispose(sendStop: boolean): void {
    if (disposed) return;
    recovery.onEvent(undefined);
    quests.onEvent(undefined);
    rewards.onEvent(undefined);
    control.onEvent(undefined);
    combat.onEvent(undefined);
    tactics.onEvent(undefined);
    cycle.onEvent(undefined);
    if (sendStop) rawHalt();
    disposed = true;
    control.dispose();
    tactics.dispose();
    recovery.dispose();
    quests.dispose();
    rewards.dispose();
    combat.dispose();
    cycle.dispose();
    navigation?.close();
  }
  return {
    control,
    combat,
    tactics,
    recovery,
    quests,
    rewards,
    cycle,
    prepareCatalog,
    navigation: getNavigation,
    observedTarget,
    halt: rawHalt,
    override,
    dispose,
  };
}
