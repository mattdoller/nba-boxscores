import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STATS_HEADERS,
  StatsApiError,
  buildRows,
  normalizeResultSets,
  sendApiRequest,
  setOffline,
} from "../../nba-api/http.js";
import { stubStatsApi } from "../helpers.js";

describe("buildRows", () => {
  it("zips headers onto each row", () => {
    assert.deepEqual(buildRows(["A", "B"], [[1, 2], [3, 4]]), [
      { A: 1, B: 2 },
      { A: 3, B: 4 },
    ]);
  });
});

describe("normalizeResultSets", () => {
  it("keys each result set by name", () => {
    const json = {
      resultSets: [
        { name: "First", headers: ["X"], rowSet: [[1]] },
        { name: "Second", headers: ["Y"], rowSet: [] },
      ],
    };

    assert.deepEqual(normalizeResultSets(json), { First: [{ X: 1 }], Second: [] });
  });

  it("accepts a single resultSet object", () => {
    const json = { resultSet: { name: "Only", headers: ["X"], rowSet: [[1]] } };

    assert.deepEqual(normalizeResultSets(json), { Only: [{ X: 1 }] });
  });

  it("returns nothing when there are no result sets", () => {
    assert.deepEqual(normalizeResultSets({}), {});
  });
});

describe("sendApiRequest", () => {
  it("sends parameters, dropping only null and undefined ones", async (t) => {
    const calls = stubStatsApi(t, { params: { ok: true } });

    await sendApiRequest("params", { A: 1, B: "", C: null, D: undefined });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, { A: "1", B: "" });
  });

  it("sends the headers stats.nba.com expects", async (t) => {
    const calls = stubStatsApi(t, { headers: {} });

    await sendApiRequest("headers");

    assert.equal(calls[0].init.headers, STATS_HEADERS);
  });

  it("returns the parsed JSON", async (t) => {
    stubStatsApi(t, { json: { rows: [1, 2, 3] } });

    assert.deepEqual(await sendApiRequest("json"), { rows: [1, 2, 3] });
  });

  it("serves repeat requests from the cache", async (t) => {
    const calls = stubStatsApi(t, { cached: { ok: true } });

    await sendApiRequest("cached", { GameID: "1" });
    const second = await sendApiRequest("cached", { GameID: "1" });
    await sendApiRequest("cached", { GameID: "2" });

    assert.deepEqual(second, { ok: true });
    assert.deepEqual(calls.map((c) => c.params.GameID), ["1", "2"]);
  });

  it("shares a request that's already on its way", async (t) => {
    const calls = stubStatsApi(t, { shared: { rows: [1, 2] } });

    const [first, second] = await Promise.all([
      sendApiRequest("shared", { GameID: "1" }),
      sendApiRequest("shared", { GameID: "1" }),
    ]);

    assert.equal(calls.length, 1);
    assert.deepEqual(first, { rows: [1, 2] });
    assert.deepEqual(second, { rows: [1, 2] });
    assert.notEqual(first, second, "each caller gets its own copy");
  });

  it("shares a failure, then sends the request again next time", async (t) => {
    const calls = stubStatsApi(t, { sharedMissing: () => new Response("", { status: 400 }) });

    const results = await Promise.allSettled([sendApiRequest("sharedMissing"), sendApiRequest("sharedMissing")]);

    assert.deepEqual(results.map((r) => r.reason?.status), [400, 400]);
    assert.equal(calls.length, 1);
    await assert.rejects(sendApiRequest("sharedMissing"), { status: 400 });
    assert.equal(calls.length, 2);
  });

  it("refetches once the TTL passes", async (t) => {
    const calls = stubStatsApi(t, { expiring: { ok: true } });

    await sendApiRequest("expiring", {}, { ttlMs: 0 });
    await sendApiRequest("expiring", {}, { ttlMs: 0 });

    assert.equal(calls.length, 2);
  });

  it("takes the TTL from the response when given a function", async (t) => {
    const calls = stubStatsApi(t, { computed: { live: true } });
    const seen = [];
    const expireNow = (json) => {
      seen.push(json);
      return 0;
    };

    await sendApiRequest("computed", {}, { ttlMs: expireNow });
    await sendApiRequest("computed", {}, { ttlMs: () => Infinity });
    await sendApiRequest("computed", {}, { ttlMs: () => Infinity });

    assert.deepEqual(seen, [{ live: true }]);
    assert.equal(calls.length, 2);
  });

  it("answers only from the cache while offline", async (t) => {
    const calls = stubStatsApi(t, { offline: { ok: true } });
    await sendApiRequest("offline", { GameID: "1" });
    setOffline("Not cached here.");
    t.after(() => setOffline(null));

    assert.deepEqual(await sendApiRequest("offline", { GameID: "1" }), { ok: true });
    await assert.rejects(sendApiRequest("offline", { GameID: "2" }), (err) => {
      assert.ok(err instanceof StatsApiError);
      assert.equal(err.status, 404);
      assert.equal(err.message, "Not cached here.");
      return true;
    });
    assert.equal(calls.length, 1);
  });

  it("throws the response status once the retry fails too", async (t) => {
    const calls = stubStatsApi(t, { failing: () => new Response("", { status: 503 }) });

    await assert.rejects(sendApiRequest("failing"), (err) => {
      assert.ok(err instanceof StatsApiError);
      assert.equal(err.status, 503);
      assert.match(err.message, /returned 503 for failing/);
      return true;
    });
    assert.equal(calls.length, 2);
  });

  it("returns and caches the retry's response when the first attempt fails", async (t) => {
    for (const status of [429, 500, 503]) {
      const endpoint = `flaky${status}`;
      let attempts = 0;
      const calls = stubStatsApi(t, {
        [endpoint]: () => {
          attempts++;
          if (attempts === 1) {
            return new Response("", { status });
          }

          return { ok: true };
        },
      });

      assert.deepEqual(await sendApiRequest(endpoint), { ok: true }, `status ${status}`);
      assert.deepEqual(await sendApiRequest(endpoint), { ok: true }, `status ${status}`);
      assert.equal(calls.length, 2, `status ${status}`);
    }
  });

  it("doesn't retry client errors other than throttling", async (t) => {
    const calls = stubStatsApi(t, { missing: () => new Response("", { status: 400 }) });

    await assert.rejects(sendApiRequest("missing"), { status: 400 });
    assert.equal(calls.length, 1);
  });

  it("doesn't cache errors", async (t) => {
    const calls = stubStatsApi(t, { uncached: () => new Response("", { status: 400 }) });

    await assert.rejects(sendApiRequest("uncached"), { status: 400 });
    await assert.rejects(sendApiRequest("uncached"), { status: 400 });
    assert.equal(calls.length, 2);
  });

  it("waits before retrying", async (t) => {
    stubStatsApi(t, { slow: () => new Response("", { status: 503 }) });
    const start = performance.now();

    await assert.rejects(sendApiRequest("slow", {}, { retryDelayMs: 50 }), { status: 503 });

    assert.ok(performance.now() - start >= 45);
  });

  it("throws a 504 when the request and its retry time out", async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    await assert.rejects(sendApiRequest("timeout"), { status: 504, message: /didn't respond/ });
    assert.equal(fetch.mock.callCount(), 2);
  });

  it("recovers when only the first request times out", async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => {
      if (fetch.mock.callCount() === 0) {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }

      return Response.json({ ok: true });
    });

    assert.deepEqual(await sendApiRequest("timeoutOnce"), { ok: true });
  });

  it("throws a 502 when stats.nba.com can't be reached", async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => {
      throw new TypeError("fetch failed");
    });

    await assert.rejects(sendApiRequest("unreachable"), {
      status: 502,
      message: "Couldn't reach stats.nba.com: fetch failed",
    });
    assert.equal(fetch.mock.callCount(), 2);
  });
});
