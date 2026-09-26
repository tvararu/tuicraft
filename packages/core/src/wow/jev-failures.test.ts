import { expect, test } from "bun:test";
import {
  jsonResponse,
  request,
  validPayload,
} from "#test-support/jev-fixtures";
import { type JevActionOptions, selectJevAction } from "#wow/jev";

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
