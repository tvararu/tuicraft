import { type Schema, schemaErrors } from "#harness/grader/json-schema";
import schema from "./scenario.schema.json" with { type: "json" };

export type TriggerName =
  | "fight_start"
  | "kill"
  | "lfg_proposal"
  | "lfg_role_check"
  | "ready_check"
  | "death"
  | "movement_start"
  | "answer_text"
  | "steer_landed"
  | "task_landed"
  | "channel_start";

export type SteerAt =
  | { kind: "trigger"; trigger: TriggerName; nth?: number; delayMs?: number }
  | { kind: "elapsed"; ms: number };

export type PartnerSetup = {
  actor?: number;
  endpoint: string;
  body: Record<string, unknown>;
};

export type PartnerAction = {
  at: SteerAt;
  argv: string[];
  windowMs: number;
  actor?: number;
};

export type ScenarioPartner = { role: "partner" | "witness"; preset: string };

export const MAX_PARTNERS = 4;

export type BotRisk = "low" | "med" | "high";

export type CheckMeasure =
  | "answer_time"
  | "answer_values"
  | "kill_after_answer"
  | "kill_xp"
  | "max_attackers"
  | "no_fight_after_stop"
  | "talents_spent";

export type TruthPick =
  | "alive"
  | "bank"
  | "durability"
  | "equipment"
  | "hearth"
  | "inventory"
  | "level"
  | "mail"
  | "money"
  | "quests"
  | "reputation"
  | "spells"
  | "totalXp";

export type TruthDelta = "money" | "totalXp";

export type TruthWho =
  | "agent"
  | "partner"
  | "partner1"
  | "partner2"
  | "partner3"
  | "partner4";

export type ConsoleVerb =
  | "group"
  | "mail"
  | "pet"
  | "titles"
  | "reputation"
  | "pinfo"
  | "guild"
  | "arena";

export type ConsoleRead = { read: ConsoleVerb; arg?: string; match: string };

export type CheckWindowAnchor = {
  event: string;
  data?: Record<string, unknown>;
};

export type CheckWindow = {
  steer?: number;
  after?: CheckWindowAnchor;
  afterMs?: number;
  untilSteer?: number;
  forMs?: number;
  exceptNames?: string[];
  max?: number;
};

export type CheckEvidence = {
  truth?: TruthPick[];
  delta?: TruthDelta[];
  items?: number[];
  point?: { x: number; y: number };
  events?: string[];
  ids?: number[];
  window?: CheckWindow;
  who?: TruthWho;
  console?: ConsoleRead;
};

export type ScenarioCheck = {
  id: string;
  source:
    | "truth"
    | "verifier"
    | "witness"
    | "game_log"
    | "session"
    | "frame"
    | "console";
  expect: string;
  evidence?: CheckEvidence;
  measure?: CheckMeasure;
  blockedBy?: string;
};

export type Scenario = {
  id: string;
  tier: number;
  preset: string;
  partner: "partner" | "witness" | null;
  setup: { endpoint: string; body: Record<string, unknown> }[];
  budget: { minutes: number; turns: number; tools: number };
  paneMinutes: number;
  task: string;
  steers: { at: SteerAt; text: string }[];
  partnerActions?: PartnerAction[];
  partners?: ScenarioPartner[];
  partnerSetup?: PartnerSetup[];
  blockedBy?: string[];
  field?: string;
  spawn?: string;
  checks: ScenarioCheck[];
  needsWatcher: boolean;
  navBound: boolean;
  botRisk: BotRisk;
};

export const ROUND_1: readonly string[] = [
  "t4-quest-first",
  "t4-quests-level-five",
  "t6-die-and-recover",
  "t4-alliance-first",
  "t7-question-while-acting",
  "t7-halt-resume",
  "t3-ghostlands-kill",
  "t1-walk-to-npc",
  "t5-vendor-buy-goldshire",
  "t5-buyback-vendor",
  "t2-whisper-reply",
  "t2-emotes-partner",
  "t0-hostiles",
  "t0-who-is-near",
  "t0-self-state",
  "t8-items-equip-upgrade",
  "t8-items-unequip",
  "t8-items-move",
  "t8-items-split",
  "t8-items-open",
  "t8-items-read",
  "t8-items-ammo",
  "t4-quests-find-giver",
  "t0-objects-read-shrine",
  "t4-objects-explore-fargodeep",
  "t4-quests-poi-walk",
  "t1-quests-read-greeting",
  "t1-quests-guard-directions",
  "t4-spells-cancel-aura",
  "t4-spells-action-bar",
  "t4-reputation-gain",
  "t4-spells-stop-channel",
  "t8-travel-bind-inn",
  "t8-travel-hearth-home",
  "t8-travel-fly",
  "t8-pets-command",
  "t6-selfstate-res",
  "t9-instances-difficulty",
  "t9-raid-kick",
  "t9-raid-convert",
  "t9-lfg-queue",
  "t9-lfg-run",
  "t9-trade-give",
  "t9-trade-receive",
  "t9-trade-swap",
  "t9-trade-cancel",
  "t9-raid-master-loot",
  "t8-quests-share",
  "t8-quests-accept-shared",
  "t9-raid-ready",
  "t9-raid-answer",
  "t9-raid-summon",
  "t9-raid-mark",
  "t4-objects-quest-loot",
  "t8-items-socket",
  "t8-pets-spells",
  "t8-pets-rename",
  "t8-pets-abandon",
  "t8-pets-stable",
  "t9-selfstate-mount",
  "t8-talents-spend",
  "t8-talents-reset",
  "t4-spells-unlearn-profession",
  "t8-vehicles-board",
  "t8-vehicles-drive",
  "t8-talents-glyph",
  "t8-pets-talent",
  "t9-bank-deposit",
  "t9-bank-withdraw",
  "t9-bank-slot",
  "t8-vehicles-zeppelin",
  "t9-mail-read",
  "t9-mail-collect",
  "t9-mail-send",
];
const DIR = `${import.meta.dir}/scenarios`;
const JSON_FILE = /\.json$/;
const SCHEMA = schema as unknown as Schema;

function whoErrors({ checks, partner, partners }: Scenario): string[] {
  const roles = new Set<string>([
    "agent",
    ...(partners?.map((_, index) => `partner${index + 1}`) ??
      (partner === null ? [] : ["partner"])),
  ]);
  return checks.flatMap(({ evidence }, index) => {
    const who = evidence?.who;
    return who === undefined || roles.has(who)
      ? []
      : [`$.checks[${index}].evidence.who: the scenario has no ${who}`];
  });
}

function regexError(match: string): string | undefined {
  try {
    new RegExp(match, "m");
    return undefined;
  } catch (err) {
    return (err as Error).message;
  }
}

const ARG_READS: ReadonlySet<ConsoleVerb> = new Set(["arena", "guild"]);

function anchorErrors(at: string, window: CheckWindow): string[] {
  return [
    ...(window.steer === undefined && window.after === undefined
      ? [`${at}.evidence.window: needs steer or after`]
      : []),
    ...(window.steer !== undefined && window.after !== undefined
      ? [`${at}.evidence.window: use steer or after, not both`]
      : []),
  ];
}

function windowErrors({ checks, steers }: Scenario): string[] {
  return checks.flatMap(({ evidence }, index) => {
    const at = `$.checks[${index}]`;
    const window = evidence?.window;
    if (window === undefined) return [];
    const last = steers.length - 1;
    const bad = (slot: number | undefined) =>
      slot !== undefined && (slot < 0 || slot > last);
    return [
      ...anchorErrors(at, window),
      ...(bad(window.steer)
        ? [`${at}.evidence.window.steer: no steer ${window.steer}`]
        : []),
      ...(bad(window.untilSteer)
        ? [`${at}.evidence.window.untilSteer: no steer ${window.untilSteer}`]
        : []),
      ...(window.untilSteer !== undefined &&
      window.steer !== undefined &&
      window.untilSteer <= window.steer &&
      !bad(window.untilSteer)
        ? [`${at}.evidence.window.untilSteer: after steer ${window.steer}`]
        : []),
      ...(window.forMs !== undefined && window.untilSteer !== undefined
        ? [`${at}.evidence.window: use forMs or untilSteer, not both`]
        : []),
    ];
  });
}

function consoleErrors({ checks }: Scenario): string[] {
  return checks.flatMap(({ evidence, source }, index) => {
    const at = `$.checks[${index}]`;
    const read = evidence?.console;
    if (read === undefined)
      return source === "console"
        ? [`${at}: a console check needs evidence.console`]
        : [];
    const error = regexError(read.match);
    const wantsArg = ARG_READS.has(read.read);
    return [
      ...(source === "console"
        ? []
        : [`${at}.evidence.console: only on a console check`]),
      ...(error === undefined
        ? []
        : [`${at}.evidence.console.match: invalid regex: ${error}`]),
      ...(wantsArg === (read.arg !== undefined)
        ? []
        : [
            `${at}.evidence.console.arg: read ${read.read} ${wantsArg ? "needs" : "takes no"} arg`,
          ]),
    ];
  });
}

function partnerErrors(scenario: Scenario): string[] {
  const {
    partner,
    partnerActions = [],
    partners,
    partnerSetup = [],
  } = scenario;
  const count = partners?.length ?? (partner === null ? 0 : 1);
  const errors = partnerActions.flatMap(({ actor }, index) =>
    actor !== undefined && actor > count
      ? [`$.partnerActions[${index}].actor: no partner ${actor}`]
      : [],
  );
  errors.push(
    ...partnerSetup.flatMap(({ actor }, index) =>
      (actor ?? 1) > count
        ? [`$.partnerSetup[${index}].actor: no partner ${actor ?? 1}`]
        : [],
    ),
  );
  errors.push(...whoErrors(scenario));
  if (partners === undefined) return errors;
  if (partner !== null)
    errors.push("$.partners: set partner or partners, not both");
  if (partners.length === 0) errors.push("$.partners: at least 1 partner");
  if (partners.length > MAX_PARTNERS)
    errors.push(`$.partners: at most ${MAX_PARTNERS} partners`);
  return errors;
}

export function parseScenario(file: string, value: unknown): Scenario {
  const errors = schemaErrors(SCHEMA, value);
  const stem = file.replace(JSON_FILE, "");
  if (errors.length === 0 && (value as Scenario).id !== stem)
    errors.push(`$.id: expected ${stem}`);
  if (errors.length === 0)
    errors.push(
      ...partnerErrors(value as Scenario),
      ...consoleErrors(value as Scenario),
      ...windowErrors(value as Scenario),
    );
  if (errors.length > 0)
    throw new Error(`invalid scenario ${file}: ${errors.join("; ")}`);
  return value as Scenario;
}

async function readScenario(file: string): Promise<Scenario> {
  const value: unknown = await Bun.file(`${DIR}/${file}`)
    .json()
    .catch((error: Error) => {
      throw new Error(`invalid scenario ${file}: ${error.message}`);
    });
  return parseScenario(file, value);
}

const SCENARIOS: ReadonlyMap<string, Scenario> = new Map(
  await Promise.all(
    [...new Bun.Glob("*.json").scanSync(DIR)]
      .toSorted()
      .map(
        async (file) =>
          [file.replace(JSON_FILE, ""), await readScenario(file)] as const,
      ),
  ),
);

export const SCENARIO_IDS: readonly string[] = [...SCENARIOS.keys()];

export function loadScenario(id: string): Scenario {
  const scenario = SCENARIOS.get(id);
  if (scenario === undefined)
    throw new Error(`unknown scenario: ${id} (known: ${ROUND_1.join(", ")})`);
  return scenario;
}
