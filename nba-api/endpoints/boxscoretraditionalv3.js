// Port of nba_api/stats/endpoints/boxscoretraditionalv3.py and its parser.
import { sendApiRequest } from "../http.js";

const TEAM_METADATA_FIELDS = ["teamId", "teamCity", "teamName", "teamTricode", "teamSlug"];

const PLAYER_METADATA_FIELDS = [
  "personId", "firstName", "familyName", "nameI", "playerSlug", "position", "comment", "jerseyNum",
];

const STATS_FIELDS = [
  "minutes",
  "fieldGoalsMade", "fieldGoalsAttempted", "fieldGoalsPercentage",
  "threePointersMade", "threePointersAttempted", "threePointersPercentage",
  "freeThrowsMade", "freeThrowsAttempted", "freeThrowsPercentage",
  "reboundsOffensive", "reboundsDefensive", "reboundsTotal",
  "assists", "steals", "blocks", "turnovers", "foulsPersonal", "points", "plusMinusPoints",
];

// Some older games send null instead of a statistics object; the picked
// fields are then undefined.
function pick(source, fields) {
  return Object.fromEntries(fields.map((f) => [f, source?.[f]]));
}

// Flattens the nested v3 response into the data sets nba_api exposes:
// { PlayerStats, TeamStats, TeamStarterBenchStats }.
export function parseBoxScoreTraditionalV3(json) {
  const box = json.boxScoreTraditional ?? {};
  const ids = { gameId: box.gameId, homeTeamId: box.homeTeamId, awayTeamId: box.awayTeamId };
  const teams = [box.homeTeam, box.awayTeam].filter(Boolean);

  return {
    PlayerStats: teams.flatMap((team) => (team.players ?? []).map((player) => ({
      ...ids,
      ...pick(team, TEAM_METADATA_FIELDS),
      ...pick(player, PLAYER_METADATA_FIELDS),
      ...pick(player.statistics, STATS_FIELDS),
    }))),
    TeamStats: teams.map((team) => ({
      ...ids,
      ...pick(team, TEAM_METADATA_FIELDS),
      ...pick(team.statistics, STATS_FIELDS),
    })),
    TeamStarterBenchStats: teams.flatMap((team) => ["starters", "bench"].map((group) => ({
      ...ids,
      ...pick(team, TEAM_METADATA_FIELDS),
      ...pick(team[group], STATS_FIELDS.filter((f) => f !== "plusMinusPoints")),
      startersBench: group,
    }))),
  };
}

export async function boxScoreTraditionalV3({
  gameId,
  startPeriod = 0,
  endPeriod = 0,
  startRange = 0,
  endRange = 0,
  rangeType = 0,
}, options) {
  const json = await sendApiRequest("boxscoretraditionalv3", {
    GameID: gameId,
    StartPeriod: startPeriod,
    EndPeriod: endPeriod,
    StartRange: startRange,
    EndRange: endRange,
    RangeType: rangeType,
  }, options);
  return parseBoxScoreTraditionalV3(json);
}
