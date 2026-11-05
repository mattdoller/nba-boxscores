// Port of nba_api/stats/endpoints/teamyearbyyearstats.py.
import { normalizeResultSets, sendApiRequest } from "../http.js";
import { LeagueID, PerMode36, SeasonType } from "../parameters.js";

// A franchise's every season, oldest first: { TeamStats: [{ TEAM_ID,
// TEAM_CITY, TEAM_NAME, YEAR ("2024-25"), GP, WINS, LOSSES, WIN_PCT,
// CONF_RANK, DIV_RANK, PO_WINS, PO_LOSSES, NBA_FINALS_APPEARANCE, PTS, ...
// }] }. TEAM_CITY and TEAM_NAME are what the team was called that season.
export async function teamYearByYearStats({
  teamId,
  perMode = PerMode36.totals,
  seasonType = SeasonType.default,
  leagueId = LeagueID.default,
}, options) {
  const json = await sendApiRequest("teamyearbyyearstats", {
    LeagueID: leagueId,
    PerMode: perMode,
    SeasonType: seasonType,
    TeamID: teamId,
  }, options);
  return normalizeResultSets(json);
}
