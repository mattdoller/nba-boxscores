// Port of nba_api's NBAHTTP / NBAStatsHTTP / NBAStatsResponse
// (nba_api/library/http.py and nba_api/stats/library/http.py).

const BASE_URL = "https://stats.nba.com/stats";
import { setTimeout as sleep } from "node:timers/promises";
import { getCached, putCached } from "./cache.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = Number(process.env.NBA_RETRY_DELAY_MS ?? 1_000);

// stats.nba.com stalls requests that don't look like they come from nba.com.
// These match nba_api's STATS_HEADERS, minus Host/Connection/Accept-Encoding,
// which fetch manages itself.
export const STATS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.5",
  Referer: "https://www.nba.com/",
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  "Sec-Ch-Ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Fetch-Dest": "empty",
};

export class StatsApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function fetchJson(url, endpoint, { headers, timeoutMs }) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new StatsApiError(504, "stats.nba.com didn't respond. It sometimes throttles or blocks requests; try again shortly.");
    }
    throw new StatsApiError(502, `Couldn't reach stats.nba.com: ${err.message}`);
  }
  if (!res.ok) {
    throw new StatsApiError(res.status, `stats.nba.com returned ${res.status} for ${endpoint}`);
  }

  return res.json();
}

// While set, requests the cache can't answer fail with this message instead
// of going to stats.nba.com. The server sets it when started offline or on
// bin/load-fixtures' test data; scripts that fill the cache leave it off.
let offlineReason = null;

// Turns offline mode on with the message to give for uncached requests, or
// off with null.
export function setOffline(reason) {
  offlineReason = reason;
}

// Requests on their way to stats.nba.com, by cache key. Opening a game sends
// the same play-by-play request from two routes at once; the second waits
// for the first instead of sending its own.
const inFlight = new Map();

// Throttling, timeouts, unreachable hosts, and server errors are often
// gone a moment later; other client errors won't change on a retry.
function isRetryable(err) {
  return err instanceof StatsApiError && (err.status === 429 || err.status >= 500);
}

// Sends a GET to an endpoint and returns the parsed JSON. Like requests, null
// and undefined parameters are dropped while empty strings are sent as-is.
// Responses are cached in SQLite for ttlMs (forever when omitted), which can
// also be a function of the response's JSON returning the TTL. A failure that
// may be temporary is retried once after retryDelayMs. A request already on
// its way is shared rather than sent again; whoever sent it first sets the
// TTL, and the others get their own copy of the JSON.
export async function sendApiRequest(endpoint, parameters = {}, options = {}) {
  const {
    ttlMs = Infinity,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    headers = STATS_HEADERS,
  } = options;
  const url = new URL(`${BASE_URL}/${endpoint}`);
  for (const [key, value] of Object.entries(parameters)) {
    if (value != null) {
      url.searchParams.set(key, value);
    }
  }

  const cacheKey = url.toString();
  const hit = getCached(cacheKey);
  if (hit !== undefined) {
    return hit;
  }
  if (offlineReason) {
    throw new StatsApiError(404, offlineReason);
  }
  if (inFlight.has(cacheKey)) {
    return structuredClone(await inFlight.get(cacheKey));
  }

  const request = fetchAndCache(url, endpoint, cacheKey, { headers, timeoutMs, retryDelayMs, ttlMs });
  inFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inFlight.delete(cacheKey);
  }
}

async function fetchAndCache(url, endpoint, cacheKey, { headers, timeoutMs, retryDelayMs, ttlMs }) {
  let json;
  try {
    json = await fetchJson(url, endpoint, { headers, timeoutMs });
  } catch (err) {
    if (!isRetryable(err)) {
      throw err;
    }

    await sleep(retryDelayMs);
    json = await fetchJson(url, endpoint, { headers, timeoutMs });
  }
  let ttl = ttlMs;
  if (typeof ttlMs === "function") {
    ttl = ttlMs(json);
  }
  putCached(cacheKey, endpoint, json, ttl);
  return json;
}

// Zips a table's headers onto each row (NBAStatsResponse._build_rows).
export function buildRows(headers, rowSet) {
  return rowSet.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
}

// Older endpoints return tables as { name, headers, rowSet }. Turns them into
// { [name]: rows[] }, like NBAStatsResponse.get_normalized_dict.
export function normalizeResultSets(json) {
  const sets = [].concat(json.resultSets ?? json.resultSet ?? []);
  return Object.fromEntries(sets.map((s) => [s.name, buildRows(s.headers, s.rowSet)]));
}
