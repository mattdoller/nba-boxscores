// Raw stats.nba.com responses for a Lakers (home) vs. Celtics (away) game.

export const LAKERS_ID = 1610612747;
export const CELTICS_ID = 1610612738;

function stats(points, extra = {}) {
  return {
    minutes: "240:00",
    fieldGoalsMade: 40,
    fieldGoalsAttempted: 85,
    fieldGoalsPercentage: 0.471,
    threePointersMade: 12,
    threePointersAttempted: 33,
    threePointersPercentage: 0.364,
    freeThrowsMade: 18,
    freeThrowsAttempted: 22,
    freeThrowsPercentage: 0.818,
    reboundsOffensive: 10,
    reboundsDefensive: 34,
    reboundsTotal: 44,
    assists: 25,
    steals: 7,
    blocks: 5,
    turnovers: 12,
    foulsPersonal: 19,
    points,
    plusMinusPoints: 0,
    ...extra,
  };
}

const lebron = {
  personId: 2544,
  firstName: "LeBron",
  familyName: "James",
  nameI: "L. James",
  playerSlug: "lebron-james",
  position: "F",
  comment: "",
  jerseyNum: "23",
  statistics: stats(30, { minutes: "36:12", reboundsTotal: 8, assists: 10, plusMinusPoints: 6 }),
};

const tatum = {
  personId: 1628369,
  firstName: "Jayson",
  familyName: "Tatum",
  nameI: "J. Tatum",
  playerSlug: "jayson-tatum",
  position: "F",
  comment: "",
  jerseyNum: "0",
  statistics: stats(28, { minutes: "38:00", plusMinusPoints: -6 }),
};

const didNotPlay = {
  personId: 1630000,
  firstName: "Bench",
  familyName: "Warmer",
  nameI: "B. Warmer",
  playerSlug: "bench-warmer",
  position: "",
  comment: "DNP - Coach's Decision",
  jerseyNum: "99",
  statistics: null,
};

export function boxScoreTraditionalJson(gameId, { players = true } = {}) {
  const team = (id, city, name, tricode, points, roster) => ({
    teamId: id,
    teamCity: city,
    teamName: name,
    teamTricode: tricode,
    teamSlug: name.toLowerCase(),
    statistics: stats(points),
    starters: stats(points - 30),
    bench: stats(30),
    players: players ? roster : [],
  });
  return {
    boxScoreTraditional: {
      gameId,
      homeTeamId: LAKERS_ID,
      awayTeamId: CELTICS_ID,
      homeTeam: team(LAKERS_ID, "Los Angeles", "Lakers", "LAL", 112, [lebron, didNotPlay]),
      awayTeam: team(CELTICS_ID, "Boston", "Celtics", "BOS", 108, [tatum]),
    },
  };
}

export function boxScoreSummaryJson(gameId) {
  const team = (id, city, name, tricode, quarters) => ({
    teamId: id,
    teamCity: city,
    teamName: name,
    teamTricode: tricode,
    teamSlug: name.toLowerCase(),
    teamWins: 1,
    teamLosses: 0,
    score: quarters.reduce((sum, q) => sum + q, 0),
    periods: quarters.map((score, i) => ({ period: i + 1, periodType: "REGULAR", score })),
  });
  return {
    boxScoreSummary: {
      gameId,
      gameCode: "20241022/BOSLAL",
      gameStatus: 3,
      gameStatusText: "Final/OT ",
      period: 5,
      gameClock: "",
      gameTimeUTC: "2024-10-23T02:00:00Z",
      gameEt: "2024-10-22T22:00:00Z",
      awayTeamId: CELTICS_ID,
      homeTeamId: LAKERS_ID,
      duration: 160,
      attendance: 18997,
      sellout: 1,
      arena: {
        arenaId: 15,
        arenaName: "Crypto.com Arena",
        arenaCity: "Los Angeles",
        arenaState: "CA",
        arenaCountry: "US",
        arenaTimezone: "Pacific",
        arenaStreetAddress: "",
        arenaPostalCode: "",
      },
      homeTeam: team(LAKERS_ID, "Los Angeles", "Lakers", "LAL", [30, 25, 27, 20, 10]),
      awayTeam: team(CELTICS_ID, "Boston", "Celtics", "BOS", [28, 26, 24, 24, 6]),
    },
  };
}

export function action(fields) {
  return {
    actionNumber: 1,
    clock: "PT12M00.00S",
    period: 1,
    teamId: 0,
    teamTricode: "",
    personId: 0,
    playerName: "",
    playerNameI: "",
    xLegacy: 0,
    yLegacy: 0,
    shotDistance: 0,
    shotResult: "",
    isFieldGoal: 0,
    scoreHome: "",
    scoreAway: "",
    pointsTotal: 0,
    location: "",
    description: "",
    actionType: "",
    subType: "",
    videoAvailable: 0,
    shotValue: 0,
    actionId: 1,
    ...fields,
  };
}

export function playByPlayJson(gameId, actions) {
  return { game: { gameId, videoAvailable: 1, actions } };
}
