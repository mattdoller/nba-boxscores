# bin/

Scripts for setting up, running, checking, and filling the app's data.

| Script | Use it to |
| --- | --- |
| [`setup`](#setup) | Get a fresh checkout ready to run |
| [`server`](#server) | Start the app |
| [`test`](#test) | Run the tests |
| [`lint`](#lint) | Check code style and likely mistakes |
| [`cache`](#cache) | See or clean up the response cache |
| [`backfill`](#backfill) | Download a whole real season into the cache |
| [`index`](#index) | Index the cached games for the player cards' season so far |
| [`load-fixtures`](#load-fixtures) | Make a fake season to try the app on |

All of them:

- Can be run from any directory; they work from the project root.
- Print their options with `-h` or `--help`.
- Exit with status 1 and a short message on an unknown option or a bad
  value.

`server`, `test`, and `lint` run `npm install` first if `node_modules` is
missing. `cache`, `backfill`, and `load-fixtures` read `.env` when it exists,
so they use the same cache file as the server.

## setup

```sh
bin/setup
```

Gets a fresh checkout ready to run:

1. Checks that Node is 24.2 or newer, and stops with a clear message if it
   isn't. The server needs `import.meta.main` (Node 24.2) and the built-in
   `node:sqlite`.
2. Runs `npm install`.
3. Copies `.env.example` to `.env`, unless there's a `.env` already.

Safe to run again: an existing `.env` is never overwritten.

## server

```sh
bin/server                                     # http://localhost:3000
bin/server --port 4000
bin/server --watch
bin/server --cache-db data/fixtures.sqlite     # the fake season
bin/server --offline                           # only what's cached
```

| Option | What it does |
| --- | --- |
| `-p`, `--port PORT` | Port to listen on (default: `PORT` from `.env`, or 3000) |
| `-c`, `--cache-db PATH` | SQLite cache to serve from (default: `NBA_CACHE_DB` from `.env`, or `data/nba-cache.sqlite`) |
| `-w`, `--watch` | Restart when a server file changes |
| `-o`, `--offline` | Never ask stats.nba.com; anything not cached gets an error instead (same as `NBA_OFFLINE=1` in `.env`) |

Options on the command line win over `.env`. Front-end files in `public/`
are served as they are, so a browser reload picks up changes to them even
without `--watch`.

Anything not in the cache is fetched from stats.nba.com when a page asks
for it, then cached: forever once a game is final, for a minute while it's
in progress.

Offline, the server never asks stats.nba.com: a page asking for something
not cached gets a "Not in the cache" error, and it says so when it starts.
A cache filled by `bin/load-fixtures` is always served offline, flag or
not, so its fake games never mix with real ones; the error then reads "Not
in the test data". The page's season menu lists only the seasons the cache
has games for while the server is offline.

## test

```sh
bin/test
bin/test test/server.test.js
bin/test --name "GET /api/boxscore"
bin/test --watch --name cache
bin/test --coverage
```

| Option | What it does |
| --- | --- |
| `-n`, `--name PATTERN` | Only run tests whose name matches PATTERN, a regular expression (can be repeated) |
| `-w`, `--watch` | Rerun when files change |
| `-c`, `--coverage` | Print a coverage report for the server, `nba-api/`, and `public/` |

With no files, runs every `test/**/*.test.js` with Node's built-in test
runner. The tests stub stats.nba.com and use an in-memory cache (set up in
`test/setup.js`), so they never use the network or touch `data/`.

The `test/public/page-*.test.js` files test the page itself: each loads
`public/index.html` into jsdom with the real `app.js`, served by the real
server on a small fake season (`test/public/page.js` sets this up), and
clicks through it like a user. Each opens one page and its tests run in
order, so a failure early in a file can fail the tests after it.
`page-a11y.test.js` runs axe-core over a game, both cards, and the player
search, minus the checks that need real layout, like color contrast.

In CI, `bin/test --coverage` puts its coverage on the run's summary page
as a table (see `dev/coverage-summary.js`).

## lint

```sh
bin/lint
bin/lint --fix
bin/lint server.js public/app.js
```

| Option | What it does |
| --- | --- |
| `-f`, `--fix` | Fix what can be fixed automatically, then report the rest |

Runs ESLint over the whole project, or just the files given. It checks the
house style (double quotes, semicolons, trailing commas on multiline lists,
braces on every `if`, 2-space indents) and likely mistakes, like unused
variables and undefined names. The rules are in `eslint.config.js`.

## cache

```sh
bin/cache                                   # what's in it
bin/cache --prune                           # delete expired responses
bin/cache --prune-season 2025               # delete everything for 2025-26
bin/cache --clear --endpoint playbyplayv3   # delete one endpoint's responses
bin/cache --clear --yes                     # delete everything, no prompt
bin/cache --cache-db data/fixtures.sqlite   # look at another cache
```

| Option | What it does |
| --- | --- |
| `-s`, `--stats` | Show responses, expired responses, size, and last fetch date by endpoint (also the default) |
| `-p`, `--prune` | Delete expired responses |
| `--prune-season YEAR` | Delete everything cached for a season, by the year it starts: `2025` is 2025–26. Asks first |
| `-c`, `--clear` | Delete every response; asks first |
| `-e`, `--endpoint NAME` | With `--clear`, only delete this endpoint's responses |
| `-y`, `--yes` | With `--clear` or `--prune-season`, don't ask first (required when not run in a terminal) |
| `--cache-db PATH` | Cache file to work on (default: `NBA_CACHE_DB` from `.env`, or `data/nba-cache.sqlite`) |

Only one of `--stats`, `--prune`, `--prune-season`, and `--clear` at a time.

`--prune-season` finds a season's responses by their URLs: game logs and
shot charts name the season (`Season=2025-26`), and a game's summary, box
score, and play-by-play have its id, whose 4th and 5th digits are the
season's (`0022500001`). That covers the regular season, play-in, and
playoffs. Before deleting, it lists what it found by endpoint. A whole
backfilled season takes about 3 hours to fetch again, so it's worth a look.

`--cache-db` takes a path relative to where you run the command, and the
file has to exist, so a typo can't create an empty cache. It wins over
`NBA_CACHE_DB` in `.env`.

`--prune`, `--prune-season`, and `--clear` also compact the file, since
SQLite otherwise keeps the space deleted rows used. Deleted responses are
fetched from stats.nba.com again the next time a page needs them. Clearing
everything also removes the mark that a cache holds fixtures.

## backfill

```sh
bin/backfill                          # last season
bin/backfill --season 2024 --delay 3
```

| Option | What it does |
| --- | --- |
| `-s`, `--season YEAR` | Season to fetch, by the year it starts: `2024` is 2024–25 (default: last season) |
| `-d`, `--delay SECONDS` | Wait at least this long between requests to stats.nba.com (default: 2) |

Downloads every game of a finished season: regular season, play-in, and
playoffs. It reads each team's game logs to find the games, then makes the
same requests a game's page makes (summary, box score, play-by-play, and
shot chart), so every game opens instantly afterwards.

Things to know:

- **It's slow on purpose.** stats.nba.com has no published rate limit, and
  throttles or blocks clients that go too fast. At one request every 2
  seconds, a full season (about 1,320 games, 4 requests each) takes about
  3 hours.
- **It's big.** A full season is roughly 350–400 MB in the cache, mostly
  play-by-play.
- **It can be stopped and rerun.** Games already cached are skipped, so a
  rerun picks up where the last one stopped and retries games that failed.
- **It stops after 3 failed games in a row**, since stats.nba.com is then
  probably throttling or blocking requests. Try again later.
- **Only finished seasons.** It refuses the season in progress.
- **Run one at a time.** The server can run alongside it, but two backfills
  double the request rate and fetch the same games.

Progress prints one line per fetched game. To leave it running in the
background with a log:

```sh
nohup bin/backfill > backfill.log 2>&1 &
tail -f backfill.log
```

## index

```sh
bin/index
bin/index --season 2025 --rebuild
bin/index --cache-db data/fixtures.sqlite
```

| Option | What it does |
| --- | --- |
| `-s`, `--season YEAR` | Only index this season, by the year it starts |
| `-r`, `--rebuild` | Empty the index (or the season's part of it) and index everything again |
| `-c`, `--cache-db PATH` | Cache file to index (default: `NBA_CACHE_DB` from `.env`, or `data/nba-cache.sqlite`) |

Adds the cache's final regular-season games to the season index, the
tables beside the cached responses that the player cards' season so far
reads (see `season-index.js`): one row per game, per player per game,
and per shot.

- **Games join the index on their own** when they're cached: by
  `bin/backfill`, `bin/load-fixtures`, or opening a final game in the app.
  This catches up on games cached before the index existed.
- **It only reads the cache.** A game missing a response is skipped, never
  fetched.
- **It's quick:** a whole backfilled season takes about half a minute and
  adds about 30 MB.
- **It can be stopped and rerun.** Games already indexed are skipped.

`bin/cache --stats` shows what's in the index; `--clear` and
`--prune-season` empty it along with the responses.

## load-fixtures

```sh
bin/load-fixtures
bin/server --cache-db data/fixtures.sqlite
```

| Option | What it does |
| --- | --- |
| `-s`, `--season YEAR` | Season to fill, by the year it starts (default: last season) |
| `-g`, `--games N` | Games per team, from 1 to 82 (default: 10) |
| `--seed N` | Seed for the made-up data; another seed makes other players and games (default: 1) |
| `-c`, `--cache-db PATH` | Cache file to fill (default: `data/fixtures.sqlite`) |
| `-r`, `--reset` | Delete the cache file first, so it holds only this run's games |

Fills a separate cache with a fake season, to try the app without
stats.nba.com or a backfilled season. The 30 teams are real; the players,
schedules, and games are made up by `dev/fake-season.js`:

- Each game is simulated possession by possession, so its box score,
  play-by-play, shot chart, and line score all agree.
- Players keep the same profile (how much they shoot, from where, how well)
  from game to game, so season totals look plausible.
- The same options always make the same games; change `--seed` for others.

Each fake player also gets a career for their player card: up to four
earlier seasons made from their profile, then the simulated one, with a
shot chart for each. The league's team stats for those seasons, which the
card shades stats against, come from the simulated games. So do the team
cards' league game log and each team's season of shots. Each team's
history has made-up records and playoffs for the earlier seasons, and its
record so far in the simulated one. Every fake player is in the player
list the search box finds them in, and every game is in the season index,
so player cards have a season so far.

The default 10 games per team (150 games) takes about half a minute and
about 65 MB, careers included.

Safeguards:

- It never writes to the real cache: it refuses a `--cache-db` that is
  `NBA_CACHE_DB` or `data/nba-cache.sqlite`.
- Fake game ids are numbered from 9001, past any real season's.
- The cache is marked as test data, and the app shows a red notice above
  the scoreboard on every game served from it.

When it's done, it prints the command to start the server on the fixtures
and a link to the first game. The server never asks stats.nba.com while
serving fixtures: anything outside the fake season, like another season or
a date without a fake game, gets a "Not in the test data" error instead of
real games.
