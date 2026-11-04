// Port of nba_api/stats/endpoints/playbyplayv3.py and its parser.
import { sendApiRequest } from "../http.js";

const ACTION_FIELDS = [
  "actionNumber", "clock", "period", "teamId", "teamTricode", "personId", "playerName",
  "playerNameI", "xLegacy", "yLegacy", "shotDistance", "shotResult", "isFieldGoal",
  "scoreHome", "scoreAway", "pointsTotal", "location", "description", "actionType",
  "subType", "videoAvailable", "shotValue", "actionId",
];

// Returns { AvailableVideo, PlayByPlay }.
export function parsePlayByPlayV3(json) {
  const game = json.game ?? {};
  return {
    AvailableVideo: [{ videoAvailable: game.videoAvailable }],
    PlayByPlay: (game.actions ?? []).map((action) => ({
      gameId: game.gameId,
      ...Object.fromEntries(ACTION_FIELDS.map((f) => [f, action[f]])),
    })),
  };
}

export async function playByPlayV3({ gameId, startPeriod = 0, endPeriod = 0 }, options) {
  const json = await sendApiRequest("playbyplayv3", {
    GameID: gameId,
    StartPeriod: startPeriod,
    EndPeriod: endPeriod,
  }, options);
  return parsePlayByPlayV3(json);
}
