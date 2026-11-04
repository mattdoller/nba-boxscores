# To do

## Test the front end

`public/app.js` runs against the page as soon as it loads, so it's tested
through the pure modules it imports from `public/lib/`. `public/events.js`
runs in a jsdom page.

- [x] Add a browser simulator (e.g. jsdom) as a dev dependency so tests can
      give the scripts a page to run against.
- [x] Move pure logic out of `public/app.js` into modules that can be tested
      without the DOM (`public/lib/`: format, stats, court, zones). `app.js`
      is now loaded as an ES module.
- [ ] Test what's left in `public/app.js` (rendering, playback, the
      play-by-play and court links) by loading it into a jsdom page with
      stubbed `/api/*` responses.
- [x] Test `public/events.js`: `track()` dispatches an `nba:track` event with
      the expected detail, `describeTarget()` describes clicked elements, and
      the session id falls back when `sessionStorage` is unavailable.
- [x] Have `bin/test` and `--coverage` pick up the new front-end tests. Put
      them under `test/public/`; coverage reports anything they load from
      `public/`.

## Possible bugs

- [x] Stop caching games in progress forever. `/api/boxscore`,
      `/api/playbyplay`, and `/api/shotchart` cache with no expiry, so a game
      requested while it's being played keeps its partial stats. Use a short
      TTL when the game status isn't "Final".
- [x] Validate `team_id` and `season` on `/api/games`. Only `game_id` is
      checked on other routes; a bad season is sent upstream as `"NaN-aN"`
      and the user gets an unclear error instead of a 400.
- [x] Retry stats.nba.com requests once, after a short delay, when they're
      throttled or time out. Today one failure goes straight to the user.

## Features

- [ ] Season views, built on the games `bin/backfill` caches (no extra
      requests to stats.nba.com once a season is filled in). Start with
      season player cards; the plan is under "Next up" in the README.
  - A team's or player's shot chart across every game in a season, with
    the hot/cold zones against the league.
  - A player's game log for the season, with trends (points, shooting,
    minutes) across it.

## Efficiency

- [ ] Share in-flight requests in `sendApiRequest`. Opening a game makes
      `/api/shotchart` and `/api/playbyplay` both fetch the same play-by-play
      before either is cached.
- [x] Add a `bin/cache` script (`--stats`, `--clear`, `--prune`). Expired
      rows are never deleted, and `data/nba-cache.sqlite` is already ~15MB.

## Project setup

- [ ] `git init` and make a first commit.
- [x] Write a README: what the app does, how to run it, and the `bin/`
      scripts.
- [x] Add `bin/setup` to run `npm install` and copy `.env.example` to `.env`
      when there isn't one.
- [x] Add ESLint and a `bin/lint` script to keep the style consistent
      (double quotes, trailing commas, braces on every `if`).
- [x] Add a GitHub Actions workflow that runs `bin/test` and lint on every
      push (`.github/workflows/ci.yml`). It starts running once the project
      is in git and pushed to GitHub.

## Code cleanup

- [x] Remove the duplicate `currentSeason` and `periodLabel` from
      `server.js`: the front end's copies now live in
      `public/lib/format.js`, which the server could import.
