// Loaded before every test file (see bin/test). Keeps the response cache in
// memory so tests never read stale responses from, or write stubbed ones to,
// the real cache in data/.
process.env.NBA_CACHE_DB = ":memory:";

// Retry stats.nba.com failures right away instead of after a pause.
process.env.NBA_RETRY_DELAY_MS = "0";
