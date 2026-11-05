// Port of nba_api/stats/endpoints/commonallplayers.py.
import { normalizeResultSets, sendApiRequest } from "../http.js";
import { LeagueID, seasonString } from "../parameters.js";

// Every player in the league's history, or only this season's with
// onlyCurrentSeason: { CommonAllPlayers: [{ PERSON_ID, DISPLAY_FIRST_LAST,
// DISPLAY_LAST_COMMA_FIRST, ROSTERSTATUS, FROM_YEAR, TO_YEAR, TEAM_ID,
// TEAM_ABBREVIATION, ... }] }. FROM_YEAR and TO_YEAR are the years their
// first and last seasons started, as strings.
export async function commonAllPlayers({
  season,
  onlyCurrentSeason = false,
  leagueId = LeagueID.default,
}, options) {
  const json = await sendApiRequest("commonallplayers", {
    IsOnlyCurrentSeason: onlyCurrentSeason ? 1 : 0,
    LeagueID: leagueId,
    Season: seasonString(season),
  }, options);
  return normalizeResultSets(json);
}
