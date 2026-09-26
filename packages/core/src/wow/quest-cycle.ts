import type { CycleObjective } from "#wow/encounter-cycle";
import type { QuestQueryResponse } from "#wow/protocol/quest-query";
import {
  objectiveProgress,
  pickObjectiveTarget,
  questObjective,
} from "#wow/quest-objective";
import type { Runtimes } from "#wow/runtime";
import type { WorldConn } from "#wow/world-conn";

const QUERY_TIMEOUT_MS = 5000;

function knownQuery(
  rt: Runtimes,
  questId: number,
): QuestQueryResponse | undefined {
  const query = rt.quests
    .snapshot()
    .queries.find((entry) => entry.questId === questId);
  return query?.status === "known" ? query.data : undefined;
}

async function questQuery(
  conn: WorldConn,
  rt: Runtimes,
  questId: number,
): Promise<QuestQueryResponse> {
  const known = knownQuery(rt, questId);
  if (known) return known;
  const { promise, resolve, reject } =
    Promise.withResolvers<QuestQueryResponse>();
  const timer = setTimeout(
    () => reject(new Error("quest_query_unanswered")),
    QUERY_TIMEOUT_MS,
  );
  const off = conn.events.quest.subscribe((event) => {
    const data = knownQuery(rt, questId);
    if (event.type === "query" && data) resolve(data);
  });
  try {
    rt.quests.query(questId);
    return await promise;
  } finally {
    clearTimeout(timer);
    off();
  }
}

export async function questCycleObjective(
  conn: WorldConn,
  rt: Runtimes,
  questId: number,
  sources: readonly number[],
): Promise<{ objective: CycleObjective; defaultMaxStarts: number }> {
  const log = () => rt.quests.snapshot().log;
  if (!log().slots.some((slot) => slot.questId === questId))
    throw new Error("quest_not_in_log");
  const objective = questObjective(
    await questQuery(conn, rt, questId),
    sources,
  );
  if ("ok" in objective) throw new Error(objective.cause);
  const required = [...objective.kills, ...objective.items].reduce(
    (sum, entry) => sum + entry.required,
    0,
  );
  const cycle: CycleObjective = {
    pick: (tried) =>
      pickObjectiveTarget({
        objective,
        log: log(),
        entities: conn.entityStore.all(),
        self: rt.control.snapshot().pose,
        tried,
      }),
    progress: () => {
      const progress = objectiveProgress(objective, log());
      return "ok" in progress ? undefined : progress;
    },
  };
  return { objective: cycle, defaultMaxStarts: required * 2 };
}
