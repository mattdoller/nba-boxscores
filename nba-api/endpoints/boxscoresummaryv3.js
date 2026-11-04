// Port of nba_api/stats/endpoints/boxscoresummaryv3.py and the parts of its
// parser this app uses.
import { sendApiRequest } from "../http.js";

const TEAM_FIELDS = ["teamId", "teamCity", "teamName", "teamTricode", "teamSlug", "teamWins", "teamLosses"];

// Returns { GameSummary, LineScore }. nba_api's LineScore keeps only
// period1Score–period4Score; this also adds a `periods` array that includes overtimes.
export function parseBoxScoreSummaryV3(json) {
  const summary = json.boxScoreSummary ?? {};
  const { gameId } = summary;

  return {
    GameSummary: [{
      gameId,
      gameCode: summary.gameCode,
      gameStatus: summary.gameStatus,
      gameStatusText: summary.gameStatusText,
      period: summary.period,
      gameClock: summary.gameClock,
      gameTimeUTC: summary.gameTimeUTC,
      gameEt: summary.gameEt,
      awayTeamId: summary.awayTeamId,
      homeTeamId: summary.homeTeamId,
      duration: summary.duration,
      attendance: summary.attendance,
      sellout: summary.sellout,
      arenaName: summary.arena?.arenaName,
      arenaCity: summary.arena?.arenaCity,
      arenaState: summary.arena?.arenaState,
      arenaCountry: summary.arena?.arenaCountry,
    }],
    LineScore: [summary.homeTeam, summary.awayTeam].filter(Boolean).map((team) => {
      const periods = (team.periods ?? []).map((p) => ({ period: p.period, score: p.score }));
      const quarterScores = Object.fromEntries([1, 2, 3, 4].map((n) => [
        `period${n}Score`,
        periods.find((p) => p.period === n)?.score ?? null,
      ]));
      return {
        gameId,
        ...Object.fromEntries(TEAM_FIELDS.map((f) => [f, team[f]])),
        ...quarterScores,
        score: team.score,
        periods,
      };
    }),
  };
}

export async function boxScoreSummaryV3({ gameId }, options) {
  const json = await sendApiRequest("boxscoresummaryv3", { GameID: gameId }, options);
  return parseBoxScoreSummaryV3(json);
}
