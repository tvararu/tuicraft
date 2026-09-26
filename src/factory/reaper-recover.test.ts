import { describe, expect, test } from "bun:test";
import { type DeadRun, deathOf, planRecovery } from "factory/reaper-recover";
import { ago, issue, marker, pr } from "test/factory-fixtures";

const head = "d".repeat(40);
const dead = "OpenHubris/auto-work-run-252-20260926T1542";
const live = "OpenHubris/auto-work-run-260-20260926T1610";
const deadReviewer = "OpenHubris/auto-review-run-301-20260926T1445";
const liveReviewer = "OpenHubris/auto-review-run-320-20260926T1600";

const claim = (run: string, minutesAgo: number, id: number) =>
  marker(
    `<!-- factory:claim ${run} --> Factory worker ${run} claimed this issue.`,
    minutesAgo,
    id,
  );
const review = (run: string, minutesAgo: number, id: number) =>
  marker(
    `<!-- factory:claim ${run} ${head} --> Factory reviewer ${run} is reviewing PR #300 at ${head.slice(0, 7)}.`,
    minutesAgo,
    id,
  );

const branch = {
  name: "factory/253-goto-blames",
  sha: "91b95006b7aebbccf168f2cf1ac7b62b17a48007",
};
const worker: DeadRun = {
  branch,
  death: "Orca marked the run dispatch_failed (timeout)",
  role: "worker",
  run: dead,
};
const reviewer: DeadRun = {
  branch: null,
  death: "it ran past the 1 h reviewer cap",
  role: "reviewer",
  run: deadReviewer,
};

describe("a dead worker", () => {
  test("its In progress card goes back to Ready, then loses the run's claim", () => {
    const card = issue(253, "in-progress", {
      markers: [claim(live, 300, 1), claim(dead, 30, 2)],
      prs: [pr({ branch: "factory/253-goto-blames", number: 300 })],
    });
    const plan = planRecovery(worker, [card, issue(254, "in-progress")]);
    expect(plan).toMatchObject([
      { issue: 253, kind: "ready" },
      { comment: 2, issue: 253, kind: "unclaim" },
    ]);
    const body = plan[0]?.kind === "ready" ? plan[0].body : "";
    for (const part of [dead, worker.death, branch.name, "91b9500", "#300"])
      expect(body).toContain(part);
  });

  test("a retry after the move to Ready still deletes the run's claim", () => {
    const card = issue(253, "ready", {
      markers: [claim(live, 300, 1), claim(dead, 30, 2)],
    });
    expect(planRecovery(worker, [card])).toEqual([
      { comment: 2, issue: 253, kind: "unclaim" },
    ]);
  });

  test("a run that left no branch and no PR says so without naming one", () => {
    const card = issue(275, "in-progress", { markers: [claim(dead, 30, 2)] });
    const [recovery] = planRecovery({ ...worker, branch: null }, [card]);
    const body = recovery?.kind === "ready" ? recovery.body : "";
    expect(body).toContain(dead);
    expect(body).not.toContain("factory/");
    expect(body).not.toMatch(/#\d/);
  });

  test("a card whose latest claim belongs to another run is left alone", () => {
    const card = issue(253, "in-progress", {
      markers: [claim(dead, 300, 1), claim(live, 30, 2)],
    });
    expect(planRecovery(worker, [card])).toEqual([]);
  });

  test("an In progress card moved after the run's claim belongs to the next worker", () => {
    const card = issue(328, "in-progress", {
      markers: [claim(dead, 20, 1)],
      prs: [pr({ branch: "factory/328-recover", number: 334 })],
      statusAt: ago(1),
    });
    expect(planRecovery(worker, [card])).toEqual([]);
  });

  test("a reviewer's later claim does not hide the worker's claim", () => {
    const card = issue(253, "in-progress", {
      markers: [claim(dead, 300, 1), review(liveReviewer, 30, 2)],
    });
    expect(planRecovery(worker, [card])).toMatchObject([
      { issue: 253, kind: "ready" },
      { comment: 1, issue: 253, kind: "unclaim" },
    ]);
  });

  test("a card that went past In progress is left alone", () => {
    const cards = (["in-review", "blocked", "done"] as const).map((status, i) =>
      issue(i + 1, status, { markers: [claim(dead, 30, i + 1)] }),
    );
    expect(planRecovery(worker, cards)).toEqual([]);
  });
});

describe("a dead reviewer", () => {
  test("its claim is deleted and other runs' claims stay", () => {
    const cards = [
      issue(222, "in-review", {
        markers: [review(liveReviewer, 200, 10), review(deadReviewer, 30, 11)],
      }),
      issue(261, "in-review", { markers: [review(liveReviewer, 20, 12)] }),
      issue(262, "in-progress", { markers: [claim(dead, 20, 13)] }),
    ];
    expect(planRecovery(reviewer, cards)).toEqual([
      { comment: 11, issue: 222, kind: "unclaim" },
    ]);
  });
});

describe("dead runs of other roles", () => {
  test("change nothing", () => {
    const card = issue(222, "in-progress", {
      markers: [claim(dead, 30, 11), review(dead, 20, 12)],
    });
    for (const role of ["merger", "qa"] as const)
      expect(planRecovery({ ...worker, role }, [card])).toEqual([]);
  });
});

describe("deathOf", () => {
  const failed = { error: "timeout", status: "dispatch_failed" };

  test("a completed run finished normally, even past its cap", () => {
    const completed = { error: null, status: "completed" };
    expect(
      deathOf(completed, { done: true, over: true, role: "worker" }),
    ).toBeNull();
  });

  test("a run that is neither done nor over its cap is alive", () => {
    expect(
      deathOf(failed, { done: false, over: false, role: "worker" }),
    ).toBeNull();
    expect(
      deathOf(undefined, { done: false, over: false, role: "worker" }),
    ).toBeNull();
  });

  test("a quiet dispatch_failed run died with Orca's error", () => {
    const death = deathOf(failed, { done: true, over: false, role: "worker" });
    expect(death).toContain("dispatch_failed");
    expect(death).toContain("timeout");
  });

  test("a run past its cap died of the cap", () => {
    const running = { status: "dispatched" };
    expect(
      deathOf(running, { done: false, over: true, role: "reviewer" }),
    ).toContain("1 h");
    expect(
      deathOf(undefined, { done: false, over: true, role: "worker" }),
    ).toContain("3 h");
  });
});
