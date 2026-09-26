import { expect, test } from "bun:test";
import { context, setup } from "test/combat-actions-fixtures";
import { jsonResponse, validPayload } from "test/jev-fixtures";
import { type JevActionOptions, selectJevAction } from "wow/jev";

test("a retained goto creature target reaches Jev as a hex GUID", async () => {
  const { actions, control } = setup();
  control.navigationError(
    { x: 5, y: 0 },
    "pathfind_find_height failed (UNKNOWN_HEIGHT)",
    { target: 0xf130003d2108604dn },
  );
  const frame = actions.observe(context);
  let body = "";
  const fetch: NonNullable<JevActionOptions["fetch"]> = async (_url, init) => {
    body = String(init?.body);
    const probabilities = Object.fromEntries(
      frame.candidates.map(({ id }) => [id, id === "wait" ? 1 : 0]),
    );
    return jsonResponse(200, {
      ...validPayload,
      answers: {
        action: {
          choice: "wait",
          confidence: 1,
          probabilities,
          type: "choice",
        },
      },
    });
  };

  const result = await selectJevAction(
    { ...frame, instruction: context.instruction },
    { apiKey: "ts_test_key", fetch, signal: new AbortController().signal },
  );

  expect(result.choice).toBe("wait");
  expect(JSON.parse(body).state.navigation).toMatchObject({
    active: false,
    refusal: "stop",
    target: "0xf130003d2108604d",
  });
});
