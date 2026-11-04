// Port of nba_api/stats/endpoints/teamgamelog.py.
import { normalizeResultSets, sendApiRequest } from "../http.js";
import { LeagueID, SeasonType, seasonString } from "../parameters.js";

// Returns { TeamGameLog: [{ Team_ID, Game_ID, GAME_DATE, MATCHUP, WL, ... }] }.
export async function teamGameLog({
  teamId,
  season,
  seasonType = SeasonType.default,
  dateFrom = "",
  dateTo = "",
  leagueId = LeagueID.default,
}, options) {
  const json = await sendApiRequest("teamgamelog", {
    TeamID: teamId,
    Season: seasonString(season),
    SeasonType: seasonType,
    DateFrom: dateFrom,
    DateTo: dateTo,
    LeagueID: leagueId,
  }, options);
  return normalizeResultSets(json);
}
