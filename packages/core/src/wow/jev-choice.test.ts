import { expect, test } from "bun:test";
import {
  jsonResponse,
  request,
  validPayload,
} from "#test-support/jev-fixtures";
import { type JevActionOptions, selectJevAction } from "#wow/jev";

test("valid closed-set Choice preserves the judgment", async () => {
  const signal = new AbortController().signal;
  let calls = 0;
  let init: RequestInit | undefined;
  let url: string | URL | Request | undefined;
  const fetch: NonNullable<JevActionOptions["fetch"]> = async (
    input,
    requestInit,
  ) => {
    calls += 1;
    url = input;
    init = requestInit;
    return jsonResponse(200, validPayload);
  };

  const result = await selectJevAction(request, {
    apiKey: "ts_test_key",
    signal,
    fetch,
  });

  expect(calls).toBe(1);
  expect(url).toBe("https://api.typesafe.ai/v1/systemone");
  expect(init?.method).toBe("POST");
  expect(init?.signal).toBe(signal);
  const body = JSON.parse(String(init?.body));
  expect(body.model).toBe("jev-latest");
  expect(body.state.standingInstruction).toBe(request.instruction);
  expect(body.state.selfHealth).toBe("high");
  expect(body.questions.action.type).toBe("choice");
  expect(body.questions.action.criteria).toEqual({
    smite: "Cast Smite at the current target",
    wait: "Do not start a new action",
  });
  expect(result).toMatchObject({
    choice: "smite",
    probabilities: { smite: 0.7, wait: 0.3 },
    confidence: 0.4,
    model: "jev-1.13.0",
    inputTokens: 318,
  });
  expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(result).includes("ts_test_key")).toBe(false);
  expect(JSON.stringify(body).includes("ts_test_key")).toBe(false);
});

test("unknown Choice id cannot escape as success", async () => {
  const fetch: NonNullable<JevActionOptions["fetch"]> = async () =>
    jsonResponse(200, {
      ...validPayload,
      answers: {
        action: {
          type: "choice",
          choice: "frostbolt",
          probabilities: { frostbolt: 1, smite: 0, wait: 0 },
          confidence: 0.9,
        },
      },
    });

  await expect(
    selectJevAction(request, {
      apiKey: "ts_test_key",
      signal: new AbortController().signal,
      fetch,
    }),
  ).rejects.toThrow("Unknown TypeSafe Choice id: frostbolt");
});

test("malformed Choice payload cannot escape as success", async () => {
  const noulFetch: NonNullable<JevActionOptions["fetch"]> = async () =>
    jsonResponse(200, {
      model: "jev-1.13.0",
      answers: { action: { type: "noul", noul: 0.2 } },
      usage: { input_tokens: 10, output_tokens: 1 },
    });
  const textFetch: NonNullable<JevActionOptions["fetch"]> = async () =>
    new Response("not-json", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });

  await expect(
    selectJevAction(request, {
      apiKey: "ts_test_key",
      signal: new AbortController().signal,
      fetch: noulFetch,
    }),
  ).rejects.toThrow("Malformed TypeSafe Choice response");
  await expect(
    selectJevAction(request, {
      apiKey: "ts_test_key",
      signal: new AbortController().signal,
      fetch: textFetch,
    }),
  ).rejects.toThrow("Malformed TypeSafe Choice response");
});

test("malformed Choice distributions cannot escape as success", async () => {
  const base = validPayload.answers.action;
  const run = async (action: unknown) =>
    selectJevAction(request, {
      apiKey: "ts_test_key",
      signal: new AbortController().signal,
      fetch: async () =>
        jsonResponse(200, { ...validPayload, answers: { action } }),
    });

  await expect(run({ ...base, probabilities: {} })).rejects.toThrow(
    "Malformed TypeSafe Choice response",
  );
  await expect(
    run({ ...base, probabilities: { smite: 0.7, wait: 0.3, frostbolt: 0 } }),
  ).rejects.toThrow("Malformed TypeSafe Choice response");
  await expect(
    run({ ...base, probabilities: { smite: -0.2, wait: 1.2 } }),
  ).rejects.toThrow("Malformed TypeSafe Choice response");
  await expect(run({ ...base, confidence: 1.2 })).rejects.toThrow(
    "Malformed TypeSafe Choice response",
  );
});

test("low-confidence complete distribution remains a judgment", async () => {
  const fetch: NonNullable<JevActionOptions["fetch"]> = async () =>
    jsonResponse(200, {
      ...validPayload,
      answers: {
        action: {
          type: "choice",
          choice: "wait",
          probabilities: { smite: 0.48, wait: 0.52 },
          confidence: 0.05,
        },
      },
    });

  const result = await selectJevAction(request, {
    apiKey: "ts_test_key",
    signal: new AbortController().signal,
    fetch,
  });
  expect(result.choice).toBe("wait");
  expect(result.confidence).toBe(0.05);
  expect(result.probabilities).toEqual({ smite: 0.48, wait: 0.52 });
});
