import type {
  FactionRelation,
  NearbyRow,
  NpcRole,
  Unsubscribe,
} from "@peon/core";
import type {
  AgentState,
  ConnectionState,
  HarnessFlags,
  Profile,
  RunPaths,
  ToolsJson,
} from "#harness/contract/config";
import type { GameLogEntry, LogDraft, LogEvent } from "#harness/contract/log";
import type {
  ToolKind,
  ToolName,
  ToolResult,
  ToolStatus,
} from "#harness/contract/result";
import type { RunRecord, RunRegistry, StopCause } from "#harness/contract/runs";
import type {
  Compass,
  InWorld,
  NoProgress,
  PoseView,
} from "#harness/contract/views";
import type { Game } from "#harness/loops/game";
import type { ControlArbiter, Grant } from "#harness/runtime/control-owner";

export type Clock = { now: () => number };

export type HandleObserver = { attach: (handle: Game) => Unsubscribe };

export type JsonlSink = {
  write: (row: unknown) => void;
  flush: () => Promise<void>;
  close: () => Promise<void>;
};

export type GameLog = {
  append: (draft: LogDraft) => GameLogEntry;
  mark: (
    seq: number,
    patch: { consumedBy?: string; delivered?: boolean },
  ) => void;
  get: (seq: number) => GameLogEntry | undefined;
  since: (seq: number) => GameLogEntry[];
  recent: (n: number) => GameLogEntry[];
  count: () => number;
  lastSeq: () => number;
  subscribe: (cb: (entry: GameLogEntry) => void) => Unsubscribe;
  flush: () => Promise<void>;
  close: () => Promise<void>;
};

export type RefTable = {
  refOf: (guid: bigint) => string;
  guidOf: (ref: string) => bigint | undefined;
  size: () => number;
};

export type Sighting = {
  guid: bigint;
  entry: number;
  name: string;
  kind: "creature" | "player";
  level: number;
  relation: FactionRelation;
  roles: NpcRole[];
  alive: boolean;
  lootable: boolean;
  mapId: number;
  x: number;
  y: number;
  z: number;
  seenAt: number;
};

export type Sightings = HandleObserver & {
  note: (row: NearbyRow) => void;
  get: (guid: bigint) => Sighting | undefined;
  all: () => Sighting[];
  forget: (guid: bigint) => void;
  prune: (now: number) => void;
};

export type ProgressTracker = HandleObserver & {
  digest: (handle: Game) => string;
  afterAction: (init: {
    tool: ToolName;
    kind: ToolKind;
    status: ToolStatus;
    reason: string | undefined;
    digest: string;
    untried: string[];
  }) => void;
  noProgress: () => NoProgress | undefined;
  lastProgress: () => { at: number; event: LogEvent } | undefined;
  count: () => number;
};

export type RepeatScene = {
  combat: string;
  targetAttacking: boolean;
  targetYd: number | undefined;
};

export type RepeatCall = {
  tool: ToolName;
  kind: ToolKind;
  args: unknown;
  pose: PoseView | undefined;
  digest: string;
  scene?: RepeatScene;
  log?: Pick<GameLog, "lastSeq" | "since">;
};

export type RepeatHit = { reason: string; times: number; untried: string[] };

export type RepeatGuard = {
  check: (call: RepeatCall) => RepeatHit | undefined;
  blocks: (call: Omit<RepeatCall, "kind">) => boolean;
  positionalPoses: (tool: ToolName) => PoseView[];
  record: (call: RepeatCall & { result: ToolResult<unknown> }) => void;
  hits: () => number;
};

export type AttackLedger = HandleObserver & {
  lastHitAt: (guid: bigint) => number | undefined;
  lastAttacker: () => bigint | undefined;
};

export type WorldSnapshots = HandleObserver & {
  capture: (cause: "look" | "tick", withinYd?: number) => void;
  write: (label: string) => Promise<string>;
};

export type ReadyGate = HandleObserver & {
  isReady: () => boolean;
  whenReady: (timeoutMs: number) => Promise<boolean>;
  inWorld: () => InWorld | undefined;
  onReady: (cb: (world: InWorld) => void) => Unsubscribe;
};

export type DeliverySink = {
  wake: (entries: GameLogEntry[]) => void;
  passive: (entry: GameLogEntry) => void;
  human: (entry: GameLogEntry) => void;
};

export type EventRouter = HandleObserver & {
  setSink: (sink: DeliverySink | undefined) => void;
};

export type YieldGate = {
  wait: () => Promise<"human">;
  trigger: () => void;
};

export type WorldMutex = { run: <T>(send: () => T) => Promise<T> };

export type ToolStats = {
  call: (tool: string) => void;
  result: (init: {
    tool: string;
    status: ToolStatus;
    reason: string | undefined;
    ms: number;
  }) => void;
  validationError: (tool: string) => void;
  repeatHit: (tool: string) => void;
  error: (init: { tool: string; message: string }) => void;
  snapshot: () => ToolsJson;
  start: (init: { path: string; everyMs: number }) => void;
  stop: () => Promise<void>;
};

export type SessionFlags = {
  agentGrant: Grant | undefined;
  humanWaiting: boolean;
  humanTexts: readonly string[];
  replyStarted: boolean;
  agent: AgentState;
  turnToolCalls: number;
  tool: string | undefined;
  lastToolCallAt: number | undefined;
  turnStartSeq: number;
  lastNow: string | undefined;
  wake: boolean;
  unreadWhispers: number;
};

export type ExploreMark = {
  direction: Compass;
  mapId: number;
  x: number;
  y: number;
};

export type TravelRecovery = {
  goal: string;
  name: string;
  unstuck: boolean;
  waypoint: string | undefined;
  waypointTried: boolean;
};

export type TravelMemory = {
  blockedBearings: Map<string, Set<Compass>>;
  exploreOrigin: { mapId: number; x: number; y: number } | undefined;
  explores: ExploreMark[];
  lastGoodPose: PoseView | undefined;
  lastRefusedGoal: string | undefined;
  obstructedExplores: Map<string, Set<Compass>>;
  recovery: TravelRecovery | undefined;
  triggers: { points: string[]; questId: number } | undefined;
  visitedCells: Set<string>;
};

export type QuestNote = {
  title: string;
  giver: string | undefined;
  objectives: string;
  ender: string | undefined;
};

export type QuestMemory = Map<number, QuestNote>;

export type Login = (profile: Profile) => Promise<Game>;

export type ViewCtx = { rt: HarnessRuntime; handle: Game };

export type OpsCtx = ViewCtx & {
  signal: AbortSignal;
  toolCallId: string;
  progress: (text: string) => void;
};

export type ToolCtx<A> = OpsCtx & { update: (partial: ToolResult<A>) => void };

export type HarnessRuntime = {
  flags: HarnessFlags;
  profile: Profile;
  paths: RunPaths;
  clock: Clock;
  log: GameLog;
  jevLog: JsonlSink;
  runs: RunRegistry;
  refs: RefTable;
  sightings: Sightings;
  progress: ProgressTracker;
  repeats: RepeatGuard;
  attacks: AttackLedger;
  snapshots: WorldSnapshots;
  ready: ReadyGate;
  router: EventRouter;
  stats: ToolStats;
  mutex: WorldMutex;
  yields: YieldGate;
  travel: TravelMemory;
  quests: QuestMemory;
  session: SessionFlags;
  handle: () => Game | undefined;
  requireHandle: () => Game;
  connection: () => ConnectionState;
  onConnection: (cb: (state: ConnectionState) => void) => Unsubscribe;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  stopAll: (cause: StopCause) => RunRecord[];
  control: ControlArbiter;
  shutdown: () => Promise<void>;
};

export type RuntimeParts = Omit<
  HarnessRuntime,
  | "session"
  | "handle"
  | "requireHandle"
  | "connection"
  | "onConnection"
  | "connect"
  | "disconnect"
  | "stopAll"
  | "control"
  | "shutdown"
> & { login: Login };
