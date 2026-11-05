// Port of nba_api/stats/endpoints/leaguegamelog.py.
import { normalizeResultSets, sendApiRequest } from "../http.js";
import { LeagueID, SeasonType, seasonString } from "../parameters.js";

// Every team's games in a season, one row per team per game: { LeagueGameLog:
// [{ TEAM_ID, TEAM_ABBREVIATION, GAME_ID, GAME_DATE ("2025-04-13"), MATCHUP,
// WL, PTS, PLUS_MINUS, FGM, FGA, ... }] }. The opponent's score is PTS minus
// PLUS_MINUS. With playerOrTeam "P", one row per player per game instead.
export async function leagueGameLog({
  season,
  seasonType = SeasonType.default,
  playerOrTeam = "T",
  counter = 0,
  direction = "ASC",
  sorter = "DATE",
  dateFrom = "",
  dateTo = "",
  leagueId = LeagueID.default,
}, options) {
  const json = await sendApiRequest("leaguegamelog", {
    Counter: counter,
    Direction: direction,
    LeagueID: leagueId,
    PlayerOrTeam: playerOrTeam,
    Season: seasonString(season),
    SeasonType: seasonType,
    Sorter: sorter,
    DateFrom: dateFrom,
    DateTo: dateTo,
  }, options);
  return normalizeResultSets(json);
}
