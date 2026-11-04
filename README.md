# NBA Box Scores

Pick an NBA team, a season, and a date it played to see that game: the box
score, every shot on a 3D court, the play-by-play, and how the score moved.
The data comes from stats.nba.com (the API behind
[nba_api](https://github.com/swar/nba_api)), and every response is cached in
SQLite so a game is only ever fetched once.

## What's on a game's page

- **Scoreboard and box scores**: the final, the line score by quarter, and
  each team's player stats, sortable by any column.
- **Shot chart and play-by-play**: every field goal attempt on a 3D court,
  with the play-by-play beside it. Hovering a shot or a play highlights the
  other; clicking a play jumps the court to that moment in the game.
- **Playback**: replays the game's shots in order, with the clock, score,
  and FG counts following along. Speeds of ½×, 1×, 2×, and 4×; Space plays
  and pauses, and the arrow keys step through quarters.
- **Hot/cold zones**: shades stats.nba.com's 14 shot zones by how each team
  shot there against the league that season (red hotter, blue colder).
  Hovering a zone outlines it.
- **Scoring runs**: the running score over the game, with scoring runs
  shaded and an optional win probability line.
- **Filters**: any quarter, and any set of players, for the charts and
  play-by-play.
- **Player cards**: clicking a name in a box score opens the player's
  regular-season career, per game or in totals, with every stat a click
  away, and each stat shaded against the league that season. Below it are
  their hot/cold zones for any season from 1996–97 on, on a half court seen
  from above.

The game on screen is in the URL, so any view can be bookmarked or shared.
Settings (light or dark, collapsed panels, toggles, playback speed, sorts)
are remembered in the browser.

## Getting started

You'll need Node 24.2 or newer.

```sh
bin/setup    # check Node, install dependencies, create .env
bin/server   # http://localhost:3000
```

`.env` (copied from `.env.example`) can set:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port the server listens on |
| `NBA_CACHE_DB` | `data/nba-cache.sqlite` | Where the response cache lives |
| `NBA_RETRY_DELAY_MS` | `1000` | Pause before retrying a failed stats.nba.com request |
| `NBA_OFFLINE` | unset | `1` serves only what's cached, never asking stats.nba.com (like `bin/server --offline`) |

## Scripts

Every script takes `--help` and can be run from any directory.
[bin/README.md](bin/README.md) has the details: every option, what each
script does under the hood, and what to watch out for.

| Script | What it does |
| --- | --- |
| `bin/setup` | Checks Node, runs `npm install`, and creates `.env` if there isn't one |
| `bin/server` | Starts the server (`--port`, `--cache-db`, `--watch` to restart on changes, `--offline` to never ask stats.nba.com) |
| `bin/test` | Runs the tests (`--name` to filter, `--watch`, `--coverage`) |
| `bin/lint` | Checks style and likely mistakes with ESLint (`--fix` to fix what it can) |
| `bin/cache` | Shows the cache's size by endpoint (`--stats`), deletes expired responses (`--prune`), a season (`--prune-season`), or everything (`--clear`); `--cache-db` picks the file |
| `bin/backfill` | Fetches and caches every game in a finished season, one request every 2 seconds (`--season`, `--delay`) |
| `bin/load-fixtures` | Fills a separate cache with a fake season to try the app on (`--games`, `--seed`, `--season`, `--reset`) |

## Trying it with fake data

Real games come from stats.nba.com one request at a time, so there's little
to look at until a season is backfilled. For a quick start, load a fake
season and point the server at it:

```sh
bin/load-fixtures            # 10 games per team in data/fixtures.sqlite
bin/server --cache-db data/fixtures.sqlite
```

The teams are real; the players, schedule, and games are made up. Each game
is simulated play by play, so its box score, play-by-play, shot chart, and
line score agree, and players keep the same profile from game to game.
`--games 82` makes a full season, and `--seed` makes a different one.
The fixtures cache is marked as test data: every game served from it says
so in a red notice above the scoreboard, and the server never asks
stats.nba.com for anything while serving it, so real games can't mix in.
The fixtures never touch the real cache either.

To serve only what's cached from the real cache too, start the server with
`bin/server --offline` (or set `NBA_OFFLINE=1` in `.env`).

## How it works

- **`server.js`** is an Express app serving `public/` and a small JSON API
  (`/api/teams`, `/api/games`, `/api/boxscore`, `/api/playbyplay`,
  `/api/shotchart`, `/api/shotzones`, `/api/player`, `/api/playerzones`,
  `/api/league`, `/api/info`).
- **`nba-api/`** is a JavaScript port of the parts of nba_api this app uses:
  the stats.nba.com endpoints, their parameters, and the headers the site
  expects. Responses are cached in SQLite by request URL (`nba-api/cache.js`):
  forever once a game is final, for a minute while it's in progress.
- **`public/`** is the front end, with no build step. `app.js` runs the page;
  the logic it shares and the tests cover lives in `public/lib/` (court
  projection, shot zones, stat sorting, saved settings).
- **`dev/`** has tools for working on the app; `fake-season.js` makes the
  fake games for `bin/load-fixtures`.
- **`test/`** uses Node's built-in test runner. stats.nba.com is stubbed and
  the cache is in memory, so the tests never touch the network or
  `data/`. `events.js` is tested in a jsdom page.

stats.nba.com has no published rate limit and sometimes stalls requests that
come too fast, so failed requests are retried once, and `bin/backfill`
spaces its requests out.

## Next up: season player cards

The player card shows a career season by season, from stats.nba.com's
career and shot chart endpoints. Next is a card for the season up to the
game on screen, built from the cached games instead: averages and totals,
shooting splits, a game log with trends, and a shot chart with hot/cold
zones against the league, all as of that date.

Almost everything it needs is already cached once a season is backfilled:

- **Box scores** have every player's line for every game, by player id.
- **Shot charts** have every shot with its player, location, zone, and
  result.
- **Game logs** give each game's date, so "up to this game" is a date
  filter.

What's missing is a way to look across games. The cache holds one JSON
response per request, so a season for one player means parsing every game
their team played, and a player traded mid-season played for two teams.

The plan:

1. **Build an index from the cache**: new SQLite tables beside the cached
   responses.
   - `games`: id, date, season, season type, home and away teams.
   - `player_games`: one row per player per game, with their stats.
   - `shots`: one row per shot, with player, game, location, zone, and
     result.

   A script fills them from what's already cached, and new final games are
   added as they're cached. A card is then one query, and "up to this game"
   is `WHERE date <= ?`. Keying rows by player handles trades.
2. **Send player ids with box scores.** `playerStats()` in `server.js` drops
   them today; the page needs them to link a player to their card.
3. **Add `/api/player`**: by player id and season, with an optional date to
   stop at.
4. **Add the card to the page**, opened from a player's name in the box
   score.

Details to get right:

- Add up makes and attempts, then work out percentages; don't average each
  game's percentage. Minutes come as `"34:12"` and need converting first.
- Work out league averages by zone from the indexed shots rather than the
  cached snapshot each shot chart carries. They're then accurate to any
  date, and stay current during a season (the cached ones are frozen when a
  game is first fetched).
- `bin/backfill` only fetches finished seasons. Cards for the season in
  progress need it to fetch the season's finished games so far, too.

More ideas and smaller fixes are in [todo.md](todo.md).
