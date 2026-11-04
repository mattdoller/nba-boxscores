// Persists stats.nba.com responses in SQLite, keyed by request URL, so they
// survive server restarts and past games are only ever fetched once.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { seasonString } from "./parameters.js";

const DB_PATH = process.env.NBA_CACHE_DB || "data/nba-cache.sqlite";

mkdirSync(dirname(DB_PATH), { recursive: true });
// The server and bin/backfill can write at once; wait for the other's write
// to finish instead of failing with "database is locked".
const db = new DatabaseSync(DB_PATH, { timeout: 5_000 });
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS responses (
    url TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    body TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER -- NULL never expires
  );
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const selectResponse = db.prepare("SELECT body, expires_at FROM responses WHERE url = ?");
const upsertResponse = db.prepare(`
  INSERT INTO responses (url, endpoint, body, fetched_at, expires_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (url) DO UPDATE SET
    body = excluded.body,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at
`);

// The cached JSON for a URL, or undefined when missing or expired.
export function getCached(url) {
  const row = selectResponse.get(url);
  if (!row || (row.expires_at != null && row.expires_at <= Date.now())) {
    return undefined;
  }

  return JSON.parse(row.body);
}

export const cachePath = DB_PATH;

// Per-endpoint counts, sizes, and fetch times, for bin/cache.
export function cacheStats() {
  return db.prepare(`
    SELECT
      endpoint,
      COUNT(*) AS responses,
      SUM(expires_at IS NOT NULL AND expires_at <= ?) AS expired,
      SUM(LENGTH(CAST(body AS BLOB))) AS bytes,
      MIN(fetched_at) AS oldest,
      MAX(fetched_at) AS newest
    FROM responses
    GROUP BY endpoint
    ORDER BY endpoint
  `).all(Date.now());
}

// Deletes expired responses and returns how many were removed.
export function pruneCache() {
  const { changes } = db.prepare("DELETE FROM responses WHERE expires_at <= ?").run(Date.now());
  compact();
  return Number(changes);
}

// Deletes every response, or only an endpoint's, and returns how many were
// removed. Clearing everything also forgets that the cache held fixtures.
export function clearCache(endpoint) {
  let result;
  if (endpoint) {
    result = db.prepare("DELETE FROM responses WHERE endpoint = ?").run(endpoint);
  } else {
    result = db.prepare("DELETE FROM responses").run();
    db.prepare("DELETE FROM meta").run();
  }
  compact();
  return Number(result.changes);
}

// Matches a season's responses, by the year it starts. Game logs and shot
// charts name their season in the URL ("Season=2025-26"); a game's other
// responses only have its id, whose 4th and 5th digits are the season's
// ("GameID=0022500001").
function seasonMatch(season) {
  return {
    where: "url LIKE ? OR url LIKE ?",
    params: [`%Season=${seasonString(season)}%`, `%GameID=___${String(season).slice(2)}%`],
  };
}

// A season's responses by endpoint: [{ endpoint, responses, bytes }].
export function seasonCacheStats(season) {
  const { where, params } = seasonMatch(season);
  return db.prepare(`
    SELECT endpoint, COUNT(*) AS responses, SUM(LENGTH(CAST(body AS BLOB))) AS bytes
    FROM responses
    WHERE ${where}
    GROUP BY endpoint
    ORDER BY endpoint
  `).all(...params);
}

// Deletes every response for a season (see seasonMatch) and returns how many
// were removed.
export function clearSeason(season) {
  const { where, params } = seasonMatch(season);
  const { changes } = db.prepare(`DELETE FROM responses WHERE ${where}`).run(...params);
  compact();
  return Number(changes);
}

// Seasons the cache has games for, newest first, by the year they start:
// those with a cached team game log listing at least one game.
export function seasonsWithGames() {
  return db.prepare(`
    SELECT DISTINCT CAST(substr(url, instr(url, 'Season=') + 7, 4) AS INTEGER) AS season
    FROM responses
    WHERE endpoint = 'teamgamelog' AND json_array_length(body, '$.resultSets[0].rowSet') > 0
    ORDER BY season DESC
  `).all().map((row) => row.season);
}

// Marks the cache as holding fake games from bin/load-fixtures, so the app
// can say its data is made up.
export function markFixtures() {
  db.prepare(`
    INSERT INTO meta (key, value) VALUES ('fixtures', 'true')
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `).run();
}

export function hasFixtures() {
  return db.prepare("SELECT 1 FROM meta WHERE key = 'fixtures'").get() !== undefined;
}

// Hands deleted rows' space back to the filesystem; deleting alone leaves
// the file the same size.
function compact() {
  db.exec("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
}

export function putCached(url, endpoint, json, ttlMs) {
  const now = Date.now();
  let expiresAt = null;
  if (Number.isFinite(ttlMs)) {
    expiresAt = now + ttlMs;
  }
  upsertResponse.run(url, endpoint, JSON.stringify(json), now, expiresAt);
}
