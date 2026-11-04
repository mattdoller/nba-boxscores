import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  cacheStats,
  clearCache,
  clearSeason,
  getCached,
  hasFixtures,
  markFixtures,
  pruneCache,
  putCached,
  seasonCacheStats,
} from "../../nba-api/cache.js";

describe("cache", () => {
  it("misses for a URL that was never stored", () => {
    assert.equal(getCached("https://example.test/missing"), undefined);
  });

  it("returns what was stored", () => {
    putCached("https://example.test/stored", "stored", { a: [1, 2] });

    assert.deepEqual(getCached("https://example.test/stored"), { a: [1, 2] });
  });

  it("keeps entries without a TTL forever", (t) => {
    putCached("https://example.test/forever", "forever", { ok: true }, Infinity);
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 10 * 365 * 86_400_000 });

    assert.deepEqual(getCached("https://example.test/forever"), { ok: true });
  });

  it("expires entries once their TTL passes", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    putCached("https://example.test/ttl", "ttl", { ok: true }, 60_000);

    t.mock.timers.tick(59_999);
    assert.deepEqual(getCached("https://example.test/ttl"), { ok: true });

    t.mock.timers.tick(1);
    assert.equal(getCached("https://example.test/ttl"), undefined);
  });

  it("replaces an existing entry", () => {
    putCached("https://example.test/replaced", "replaced", { version: 1 });
    putCached("https://example.test/replaced", "replaced", { version: 2 });

    assert.deepEqual(getCached("https://example.test/replaced"), { version: 2 });
  });
});

describe("cacheStats", () => {
  it("counts responses, expired ones, and sizes by endpoint", (t) => {
    clearCache();
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    putCached("https://example.test/a1", "alpha", { n: 1 });
    t.mock.timers.tick(1_000);
    putCached("https://example.test/a2", "alpha", { n: 22 }, 500);
    putCached("https://example.test/b1", "beta", "é");
    t.mock.timers.tick(500);

    // SQLite rows have no prototype; copy them so they compare as plain objects.
    assert.deepEqual(cacheStats().map((r) => ({ ...r })), [
      { endpoint: "alpha", responses: 2, expired: 1, bytes: 15, oldest: 1_000_000, newest: 1_001_000 },
      { endpoint: "beta", responses: 1, expired: 0, bytes: 4, oldest: 1_001_000, newest: 1_001_000 },
    ]);
  });

  it("is empty when nothing is cached", () => {
    clearCache();

    assert.deepEqual(cacheStats(), []);
  });
});

describe("pruneCache", () => {
  it("deletes only expired responses", (t) => {
    clearCache();
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    putCached("https://example.test/expired", "prune", { n: 1 }, 100);
    putCached("https://example.test/fresh", "prune", { n: 2 }, 10_000);
    putCached("https://example.test/permanent", "prune", { n: 3 });
    t.mock.timers.tick(100);

    assert.equal(pruneCache(), 1);
    assert.equal(getCached("https://example.test/expired"), undefined);
    assert.deepEqual(getCached("https://example.test/fresh"), { n: 2 });
    assert.deepEqual(getCached("https://example.test/permanent"), { n: 3 });
  });
});

describe("clearCache", () => {
  it("deletes every response", () => {
    clearCache();
    putCached("https://example.test/c1", "one", {});
    putCached("https://example.test/c2", "two", {});

    assert.equal(clearCache(), 2);
    assert.deepEqual(cacheStats(), []);
  });

  it("deletes only one endpoint's responses when given one", () => {
    clearCache();
    putCached("https://example.test/d1", "keep", { kept: true });
    putCached("https://example.test/d2", "drop", {});
    putCached("https://example.test/d3", "drop", {});

    assert.equal(clearCache("drop"), 2);
    assert.deepEqual(getCached("https://example.test/d1"), { kept: true });
    assert.deepEqual(cacheStats().map((r) => r.endpoint), ["keep"]);
  });
});

describe("clearSeason", () => {
  const base = "https://stats.nba.com/stats";
  const urls = {
    log2024: `${base}/teamgamelog?TeamID=1&Season=2024-25&SeasonType=Regular+Season`,
    log2025: `${base}/teamgamelog?TeamID=1&Season=2025-26&SeasonType=Regular+Season`,
    box2024: `${base}/boxscoresummaryv3?GameID=0022400005`,
    playoffs2024: `${base}/playbyplayv3?GameID=0042400101&StartPeriod=0&EndPeriod=0`,
    box2025: `${base}/boxscoresummaryv3?GameID=0022500005`,
    // A 2025 game whose number happens to end in 24.
    box2025Game24: `${base}/boxscoresummaryv3?GameID=0022500024`,
    chart2024: `${base}/shotchartdetail?TeamID=0&Season=2024-25&GameID=0022400005`,
  };

  before(() => {
    for (const [name, url] of Object.entries(urls)) {
      putCached(url, url.split("/").pop().split("?")[0], { name });
    }
  });

  it("counts a season's responses by endpoint", () => {
    assert.deepEqual(seasonCacheStats(2024).map(({ endpoint, responses }) => ({ endpoint, responses })), [
      { endpoint: "boxscoresummaryv3", responses: 1 },
      { endpoint: "playbyplayv3", responses: 1 },
      { endpoint: "shotchartdetail", responses: 1 },
      { endpoint: "teamgamelog", responses: 1 },
    ]);
  });

  it("deletes only that season's game logs, shot charts, and games", () => {
    assert.equal(clearSeason(2024), 4);

    for (const name of ["log2024", "box2024", "playoffs2024", "chart2024"]) {
      assert.equal(getCached(urls[name]), undefined, name);
    }
    for (const name of ["log2025", "box2025", "box2025Game24"]) {
      assert.deepEqual(getCached(urls[name]), { name }, name);
    }
    assert.deepEqual(seasonCacheStats(2024), []);
  });
});

describe("markFixtures", () => {
  it("marks the cache as holding fixtures until it's cleared entirely", () => {
    assert.equal(hasFixtures(), false);

    markFixtures();
    markFixtures();
    assert.equal(hasFixtures(), true);

    clearCache("one-endpoint");
    assert.equal(hasFixtures(), true);

    clearCache();
    assert.equal(hasFixtures(), false);
  });
});
