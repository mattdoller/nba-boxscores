// Port of nba_api/stats/endpoints/playercareerstats.py.
import { normalizeResultSets, sendApiRequest } from "../http.js";
import { PerMode36 } from "../parameters.js";

// Returns a player's career by season and in total, for the regular season,
// playoffs, and All-Star games: { SeasonTotalsRegularSeason,
// CareerTotalsRegularSeason, SeasonTotalsPostSeason, ... }. Season rows have
// SEASON_ID ("2023-24"), TEAM_ID, TEAM_ABBREVIATION, PLAYER_AGE, GP, GS,
// MIN, and the box score totals (FGM, FGA, ..., PTS). A season split across
// teams has a row for each, plus a total row with TEAM_ID 0.
export async function playerCareerStats({ playerId, perMode = PerMode36.default, leagueId = "" }, options) {
  const json = await sendApiRequest("playercareerstats", {
    PerMode: perMode,
    PlayerID: playerId,
    LeagueID: leagueId,
  }, options);
  return normalizeResultSets(json);
}
