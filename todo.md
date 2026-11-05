# To do

## Test the front end

The modules in `public/ui/` work on the page as soon as they load, so
they're tested through the pure modules they import from `public/lib/`.
`public/events.js` runs in a jsdom page.

- [ ] Test the `public/ui/` modules (rendering, playback, the play-by-play
      and court links) by loading the page into jsdom with stubbed `/api/*`
      responses.
- [ ] Move the win probability math in `public/ui/winprob.js` into
      `public/lib/` so it can be tested on its own.

## Features

- [ ] Season views, built on the games `bin/backfill` caches (no extra
      requests to stats.nba.com once a season is filled in). Start with
      season player cards; the plan is under "Next up" in the README.
  - A team's or player's shot chart across every game in a season, with
    the hot/cold zones against the league.
  - A player's game log for the season, with trends (points, shooting,
    minutes) across it.
