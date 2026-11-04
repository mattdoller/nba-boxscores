// The subset of nba_api/stats/library/parameters.py this app uses.

export const LeagueID = { nba: "00", default: "00" };

export const SeasonType = {
  regular: "Regular Season",
  preseason: "Pre Season",
  playIn: "PlayIn",
  playoffs: "Playoffs",
  allStar: "All Star",
  default: "Regular Season",
};

// How player career stats are totaled: Totals (the default) is season sums.
export const PerMode36 = { totals: "Totals", perGame: "PerGame", default: "Totals" };

// Shot chart measures; FGA returns every attempt, PTS (the default) only makes.
export const ContextMeasure = { fga: "FGA", fgm: "FGM", pts: "PTS", default: "PTS" };

// Seasons are labeled like "2024-25" (Season.default in nba_api is the current one).
export function seasonString(startYear) {
  const year = Number(startYear);
  return `${year}-${String(year + 1).slice(2)}`;
}

// Game ids look like "0022400001": a season type digit, then the season's
// start year (two digits), then the game number.
const SEASON_TYPES_BY_GAME_ID = {
  1: SeasonType.preseason,
  2: SeasonType.regular,
  3: SeasonType.allStar,
  4: SeasonType.playoffs,
  5: SeasonType.playIn,
};

export function seasonTypeFromGameId(gameId) {
  return SEASON_TYPES_BY_GAME_ID[String(gameId)[2]];
}

export function seasonFromGameId(gameId) {
  const yy = Number(String(gameId).slice(3, 5));
  // The league's first season was 1946–47.
  if (yy >= 46) {
    return 1900 + yy;
  }
  return 2000 + yy;
}
