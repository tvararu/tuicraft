import { test, expect } from "bun:test";
import {
  selectJevAction,
  type JevActionOptions,
  type JevActionRequest,
} from "wow/jev";

const request: JevActionRequest = {
  instruction: "Kill the target, spend mana",
  observation: { selfHealth: "high", targetHealth: "low", activity: "idle" },
  candidates: [
    { id: "smite", description: "Cast Smite at the current target" },
    { id: "wait", description: "Do not start a new action" },
  ],
};

const validPayload = {
  model: "jev-1.13.0",
  answers: {
    action: {
      type: "choice",
      choice: "smite",
      probabilities: { smite: 0.7, wait: 0.3 },
      confidence: 0.4,
    },
  },
  usage: { input_tokens: 318, output_tokens: 34 },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

test("HTTP rejection remains a failure without retry", async () => {
  let calls = 0;
  const fetch: NonNullable<JevActionOptions["fetch"]> = async () => {
    calls += 1;
    return jsonResponse(529, { error: "overloaded" });
  };

  await expect(
    selectJevAction(request, {
      apiKey: "ts_test_key",
      signal: new AbortController().signal,
      fetch,
    }),
  ).rejects.toThrow("TypeSafe HTTP 529");
  expect(calls).toBe(1);
});

test("network rejection remains a failure without retry", async () => {
  let calls = 0;
  const fetch: NonNullable<JevActionOptions["fetch"]> = async () => {
    calls += 1;
    throw new Error("ECONNRESET");
  };

  await expect(
    selectJevAction(request, {
      apiKey: "ts_test_key",
      signal: new AbortController().signal,
      fetch,
    }),
  ).rejects.toThrow("ECONNRESET");
  expect(calls).toBe(1);
});

test("abort propagates and does not retry", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetch: NonNullable<JevActionOptions["fetch"]> = async (
    _input,
    init,
  ) => {
    calls += 1;
    const { promise, reject } = Promise.withResolvers<Response>();
    const fail = () =>
      reject(new DOMException("The operation was aborted.", "AbortError"));
    if (init?.signal?.aborted) fail();
    else init?.signal?.addEventListener("abort", fail, { once: true });
    return await promise;
  };

  const pending = selectJevAction(request, {
    apiKey: "ts_test_key",
    signal: controller.signal,
    fetch,
  });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(1);
});

test("late 2xx after abort is not a successful Choice", async () => {
  const controller = new AbortController();
  const fetch: NonNullable<JevActionOptions["fetch"]> = async () => {
    controller.abort();
    return jsonResponse(200, validPayload);
  };

  await expect(
    selectJevAction(request, {
      apiKey: "ts_test_key",
      signal: controller.signal,
      fetch,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
});

test("missing API key fails without a network call", async () => {
  let calls = 0;
  const fetch: NonNullable<JevActionOptions["fetch"]> = async () => {
    calls += 1;
    return jsonResponse(200, validPayload);
  };

  await expect(
    selectJevAction(request, {
      apiKey: "",
      signal: new AbortController().signal,
      fetch,
    }),
  ).rejects.toThrow("Missing TypeSafe API key");
  expect(calls).toBe(0);
});

test("missing probability keys and non-unit totals fail", async () => {
  for (const probabilities of [{ smite: 1 }, { smite: 0.2, wait: 0.3 }]) {
    await expect(
      selectJevAction(request, {
        apiKey: "ts_test_key",
        signal: new AbortController().signal,
        fetch: async () =>
          jsonResponse(200, {
            ...validPayload,
            answers: {
              action: { ...validPayload.answers.action, probabilities },
            },
          }),
      }),
    ).rejects.toThrow("Malformed TypeSafe Choice response");
  }
});

test("rejected probability totals retain the response failure boundary", async () => {
  await expect(
    selectJevAction(request, {
      apiKey: "ts_test_key",
      signal: new AbortController().signal,
      fetch: async () =>
        jsonResponse(200, {
          ...validPayload,
          answers: {
            action: {
              ...validPayload.answers.action,
              probabilities: { smite: 0.2, wait: 0.3 },
            },
          },
        }),
    }),
  ).rejects.toMatchObject({
    cause: { field: "probabilities.total", total: 0.5 },
  });
});

test("JSON read failures retain raw causes without serializing them", async () => {
  const raw = {
    toJSON: () => {
      throw new Error("Raw cause serialized");
    },
  };
  const response = jsonResponse(200, {});
  Object.defineProperty(response, "json", {
    value: async () => {
      throw raw;
    },
  });
  await expect(
    selectJevAction(request, {
      apiKey: "ts_test_key",
      signal: new AbortController().signal,
      fetch: async () => response,
    }),
  ).rejects.toMatchObject({ cause: { field: "json", error: raw } });
});

test("rounded probabilities do not require exact floating point equality", async () => {
  const result = await selectJevAction(request, {
    apiKey: "ts_test_key",
    signal: new AbortController().signal,
    fetch: async () =>
      jsonResponse(200, {
        ...validPayload,
        answers: {
          action: {
            ...validPayload.answers.action,
            probabilities: { smite: 0.7, wait: 0.30000001 },
          },
        },
      }),
  });
  expect(result.probabilities).toEqual({ smite: 0.7, wait: 0.30000001 });
});

test("token counts must be nonnegative safe integers", async () => {
  for (const usage of [
    { input_tokens: -1, output_tokens: 0 },
    { input_tokens: 1.5, output_tokens: 0 },
    { input_tokens: Number.MAX_SAFE_INTEGER + 1, output_tokens: 0 },
    { input_tokens: 1, output_tokens: -1 },
  ]) {
    await expect(
      selectJevAction(request, {
        apiKey: "ts_test_key",
        signal: new AbortController().signal,
        fetch: async () => jsonResponse(200, { ...validPayload, usage }),
      }),
    ).rejects.toThrow("Malformed TypeSafe Choice response");
  }
});

test("nonfinite numeric values fail the response boundary", async () => {
  for (const action of [
    { ...validPayload.answers.action, confidence: NaN },
    {
      ...validPayload.answers.action,
      probabilities: { smite: Infinity, wait: 0 },
    },
  ]) {
    await expect(
      selectJevAction(request, {
        apiKey: "ts_test_key",
        signal: new AbortController().signal,
        fetch: async () =>
          jsonResponse(200, { ...validPayload, answers: { action } }),
      }),
    ).rejects.toThrow("Malformed TypeSafe Choice response");
  }
});

test("already aborted requests never reach the provider", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await expect(
    selectJevAction(request, {
      apiKey: "ts_test_key",
      signal: controller.signal,
      fetch: async () => {
        calls += 1;
        return jsonResponse(200, validPayload);
      },
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(0);
});
