import { describe, expect, test } from "bun:test";
import {
  createService,
  defaultServiceUrl,
  type Fetch,
  isCharEndpoint,
  ServiceError,
  serviceUrl,
} from "#factory/t1-service";

type Call = { url: string; method: string; body?: string; signal: boolean };

function fake(status: number, body: string) {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({
      body: init.body as string | undefined,
      method: init.method ?? "GET",
      signal: init.signal instanceof AbortSignal,
      url,
    });
    return new Response(body, { status });
  };
  return { calls, fetch };
}

const ok = (data: object) => JSON.stringify({ ok: true, ...data });
const base = "http://t1.test:7879";

async function reason(promise: Promise<unknown>): Promise<string> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof ServiceError))
    throw new Error(`no ServiceError: ${err}`);
  return err.reason;
}

describe("serviceUrl", () => {
  test("env wins, then soap.env, then the default", () => {
    expect(serviceUrl({ TUICRAFT_T1_SERVICE: "http://a:1/" }, {})).toBe(
      "http://a:1",
    );
    expect(serviceUrl({}, { TUICRAFT_T1_SERVICE: "http://b:2" })).toBe(
      "http://b:2",
    );
    expect(serviceUrl({}, {})).toBe(defaultServiceUrl);
    expect(defaultServiceUrl).toBe("http://100.73.138.96:7879");
  });
});

describe("createService", () => {
  test("reads truth for a factory character with a timeout", async () => {
    const { calls, fetch } = fake(200, ok({ name: "Fgklgoafpfk" }));
    const service = createService({ baseUrl: base, fetch });
    expect(await service.truth("Fgklgoafpfk")).toMatchObject({
      name: "Fgklgoafpfk",
    });
    expect(calls).toEqual([
      {
        body: undefined,
        method: "GET",
        signal: true,
        url: `${base}/truth/Fgklgoafpfk`,
      },
    ]);
  });

  test("posts setup bodies as JSON to the char endpoint", async () => {
    const { calls, fetch } = fake(200, ok({}));
    const service = createService({ baseUrl: base, fetch });
    await service.char("Fgklgoafpfk", "items/add", { count: 2, item: 159 });
    expect(calls[0]).toMatchObject({
      body: '{"count":2,"item":159}',
      method: "POST",
      url: `${base}/char/Fgklgoafpfk/items/add`,
    });
  });

  test("resets a factory account", async () => {
    const { calls, fetch } = fake(200, ok({}));
    await createService({ baseUrl: base, fetch }).reset("FAC6AB6E05F5A");
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `${base}/account/FAC6AB6E05F5A/reset`,
    });
  });

  test("health, presets and accounts are plain reads", async () => {
    const { calls, fetch } = fake(200, ok({}));
    const service = createService({ baseUrl: base, fetch });
    await service.health();
    await service.presets();
    await service.accounts();
    expect(calls.map((c) => c.url)).toEqual([
      `${base}/health`,
      `${base}/presets`,
      `${base}/accounts`,
    ]);
  });

  test("error bodies surface their reason code", async () => {
    const { fetch } = fake(
      409,
      JSON.stringify({
        error: "Fgklgoafpfk is online",
        ok: false,
        reason: "character_online",
      }),
    );
    const service = createService({ baseUrl: base, fetch });
    const err = await service
      .char("Fgklgoafpfk", "level", { level: 12 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err).toMatchObject({
      message: "character_online: Fgklgoafpfk is online",
      reason: "character_online",
      status: 409,
    });
  });

  test("a non-JSON body is a bad_response", async () => {
    const { fetch } = fake(502, "<html>bad gateway</html>");
    expect(await reason(createService({ baseUrl: base, fetch }).health())).toBe(
      "bad_response",
    );
  });

  test("a slow service times out", async () => {
    const fetch: Fetch = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        ),
      );
    const service = createService({ baseUrl: base, fetch, timeoutMs: 5 });
    expect(await reason(service.health())).toBe("timeout");
  });

  test("a refused connection is unreachable", async () => {
    const fetch: Fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await reason(createService({ baseUrl: base, fetch }).health())).toBe(
      "unreachable",
    );
  });

  test("refuses protected names before any request", async () => {
    const { calls, fetch } = fake(200, ok({}));
    const service = createService({ baseUrl: base, fetch });
    for (const name of ["Xiara", "ADMIN", "Tplhunter", "Fgklgoafpf"])
      expect(await reason(service.truth(name))).toBe("protected_account");
    expect(await reason(service.char("Xiara", "money", { copper: 1 }))).toBe(
      "protected_account",
    );
    for (const account of ["ADMIN", "RNDBOT12", "TCPRESETS", "fac6ab6e05f5a"])
      expect(await reason(service.reset(account))).toBe("protected_account");
    expect(calls).toEqual([]);
  });
});

test("rejects an unknown endpoint before any request", async () => {
  const { calls, fetch } = fake(200, ok({}));
  const service = createService({ baseUrl: base, fetch });
  expect(await reason(service.char("Fgklgoafpfk", "../reset" as "level"))).toBe(
    "unknown_endpoint",
  );
  expect(calls).toEqual([]);
});

describe("isCharEndpoint", () => {
  test("allows the documented setup endpoints only", () => {
    for (const name of ["position", "items/clear-bags", "quest/objective"])
      expect(isCharEndpoint(name)).toBe(true);
    for (const name of ["../account/X/reset", "truth", "items"])
      expect(isCharEndpoint(name)).toBe(false);
  });
});
