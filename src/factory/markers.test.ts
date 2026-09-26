import { describe, expect, test } from "bun:test";
import { liveLandings, reviewerClaimed, workerClaimed } from "factory/markers";
import { ago, issue, marker, now } from "test/factory-fixtures";

const head = "d".repeat(40);
const worker = "OpenHubris/auto-work-run-1";
const reviewer = "OpenHubris/auto-review-run-1";
const merger = "OpenHubris/auto-merge-run-1";

describe("a visible sentence after the marker", () => {
  test("keeps a worker claim live", () => {
    const body = `<!-- factory:claim ${worker} --> Factory worker ${worker} claimed this issue.`;
    const card = issue(1, "ready", {
      markers: [marker(body, 5)],
      statusAt: ago(10),
    });
    expect(workerClaimed(card, now)).toBe(true);
  });

  test("keeps a reviewer claim on its own head only", () => {
    const body = `<!-- factory:claim ${reviewer} ${head} --> Factory reviewer ${reviewer} is reviewing PR #10 at ${head.slice(0, 7)}.`;
    const card = issue(1, "in-review", { markers: [marker(body, 5)] });
    expect(reviewerClaimed(card, head, now)).toBe(true);
    expect(reviewerClaimed(card, "e".repeat(40), now)).toBe(false);
  });

  test("keeps a landing listed with its run", () => {
    const body = `<!-- factory:landing ${merger} --> Factory merger ${merger} is landing PR #10.`;
    const card = issue(1, "in-review", { markers: [marker(body, 5, 7)] });
    expect(liveLandings([card], now)).toEqual([
      { at: ago(5), id: 7, issue: 1, run: merger },
    ]);
  });
});
