import { expect, test } from "bun:test";
import { jsonResponse, request, validPayload } from "test/jev-fixtures";
import { selectJevAction } from "wow/jev";

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
            probabilities: { smite: 0.7, wait: 0.300_000_01 },
          },
        },
      }),
  });
  expect(result.probabilities).toEqual({ smite: 0.7, wait: 0.300_000_01 });
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
    { ...validPayload.answers.action, confidence: Number.NaN },
    {
      ...validPayload.answers.action,
      probabilities: { smite: Number.POSITIVE_INFINITY, wait: 0 },
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

test("probabilities within tolerance are renormalised", async () => {
  const result = await selectJevAction(request, {
    apiKey: "ts_test_key",
    signal: new AbortController().signal,
    fetch: async () =>
      jsonResponse(200, {
        ...validPayload,
        answers: {
          action: {
            ...validPayload.answers.action,
            choice: "smite",
            probabilities: { smite: 0.6, wait: 0.39 },
          },
        },
      }),
  });
  expect(result.choice).toBe("smite");
  const smite = result.probabilities["smite"];
  const wait = result.probabilities["wait"];
  expect(smite).toBeDefined();
  expect(wait).toBeDefined();
  expect(Math.abs((smite ?? 0) + (wait ?? 0) - 1)).toBeLessThan(1e-9);
  expect(Math.abs((smite ?? 0) / (wait ?? 1) - 0.6 / 0.39)).toBeLessThan(1e-9);
});

test("probability totals outside renormalisation tolerance are rejected", async () => {
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
              probabilities: { smite: 0.5, wait: 0.4 },
            },
          },
        }),
    }),
  ).rejects.toMatchObject({
    cause: { field: "probabilities.total", total: 0.9 },
  });
});
