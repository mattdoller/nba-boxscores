// Port of nba_api/stats/endpoints/leaguedashteamstats.py.
import { normalizeResultSets, sendApiRequest } from "../http.js";
import { LeagueID, PerMode36, SeasonType, seasonString } from "../parameters.js";

// Returns every team's stats for a season: { LeagueDashTeamStats: [{ TEAM_ID,
// TEAM_NAME, GP, W, L, MIN, FGM, FGA, FG3M, FG3A, FTM, FTA, OREB, DREB, REB,
// AST, TOV, STL, BLK, PF, PTS, ... }] }. With the default Totals, MIN is the
// team's minutes (48 a game, plus overtime), not its players'.
export async function leagueDashTeamStats({
  season,
  seasonType = SeasonType.default,
  measureType = "Base",
  perMode = PerMode36.totals,
  leagueId = LeagueID.default,
}, options) {
  const json = await sendApiRequest("leaguedashteamstats", {
    MeasureType: measureType,
    PerMode: perMode,
    PlusMinus: "N",
    PaceAdjust: "N",
    Rank: "N",
    Season: seasonString(season),
    SeasonType: seasonType,
    Outcome: "",
    Location: "",
    Month: 0,
    SeasonSegment: "",
    DateFrom: "",
    DateTo: "",
    OpponentTeamID: 0,
    VsConference: "",
    VsDivision: "",
    TeamID: 0,
    Conference: "",
    Division: "",
    GameSegment: "",
    Period: 0,
    ShotClockRange: "",
    LastNGames: 0,
    GameScope: "",
    PlayerExperience: "",
    PlayerPosition: "",
    StarterBench: "",
    TwoWay: 0,
    LeagueID: leagueId,
  }, options);
  return normalizeResultSets(json);
}
