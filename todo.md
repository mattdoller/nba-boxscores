# To do

## Test the front end

`public/app.js` runs against the page as soon as it loads, so it's tested
through the pure modules it imports from `public/lib/`. `public/events.js`
runs in a jsdom page.

- [ ] Test what's left in `public/app.js` (rendering, playback, the
      play-by-play and court links) by loading it into a jsdom page with
      stubbed `/api/*` responses.

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
