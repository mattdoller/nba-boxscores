// What's on screen that several modules change: the game, the quarter and
// players it's filtered to, and the parts of the trend, zones, and player
// card that outlive a single render.

export const state = {
  // The game on screen, or null.
  currentGame: null,
  // The quarter ("all" or a period number) the shot charts and play-by-play
  // are filtered to.
  selectedPeriod: "all",
  // The players whose shots the charts are limited to (see playerKey); empty
  // means everyone.
  selectedPlayers: new Set(),
  // The league's numbers by zone for the game's season, which the hot/cold
  // zones compare with: null until loaded, "error" if they couldn't be.
  leagueZones: null,
  // The card on screen: { id, name, team, position, career, error, season,
  // zones: Map(season -> zones data, "loading", or an Error) }.
  playerCard: null,
  // The team card on screen: { id, name, season, data (from /api/team, null
  // while loading), error, zones (from /api/teamzones, "loading", or an
  // Error) }.
  teamCard: null,
  // A range dragged across the trend, in seconds since tip-off. `from` is where
  // the drag started, so it can be after `to`.
  trendSelection: null,
  // The drag in progress: where it started, whether Shift was held, and whether
  // it has moved far enough to count as a drag rather than a click.
  trendDrag: null,
  // Where the last plain click on the trend landed, in seconds since tip-off. A
  // shift-click selects from here when there's no range yet.
  trendAnchor: null,
};
