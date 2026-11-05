import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { clearIndex, gamesThrough, indexGame, indexStats, isIndexed, playerGames, zonesThrough } from "../season-index.js";

// The index shares the tests' in-memory cache, so these use a season of
// their own.
const SEASON = 1999;
const HOME = 10;
const AWAY = 20;

function game(gameId, date, homePts, awayPts, lines, shots = []) {
  return {
    gameId,
    season: SEASON,
    date,
    teams: [
      { teamId: HOME, homeTeamId: HOME, awayTeamId: AWAY, points: homePts },
      { teamId: AWAY, homeTeamId: HOME, awayTeamId: AWAY, points: awayPts },
    ],
    players: lines.map(([personId, teamId, minutes, points, starter = true]) => ({
      personId, teamId, minutes, points, position: starter ? "G" : "", fieldGoalsMade: 1, fieldGoalsAttempted: 2, plusMinusPoints: 3,
    })),
    shots,
  };
}

describe("the season index", () => {
  beforeEach(() => clearIndex(SEASON));

  it("keeps each player's line from each game, oldest first", () => {
    indexGame(game("0029900002", "1999-11-03", 100, 90, [[1, HOME, "30:15", 22]]));
    indexGame(game("0029900001", "1999-11-01", 95, 99, [[1, HOME, "PT28M00.00S", 18], [2, AWAY, "12:00", 6, false]]));

    const rows = playerGames(1, SEASON);
    assert.deepEqual(rows.map((r) => [r.date, r.pts, r.seconds, r.starter, r.home_pts, r.away_pts]), [
      ["1999-11-01", 18, 1680, 1, 95, 99],
      ["1999-11-03", 22, 1815, 1, 100, 90],
    ]);
    assert.equal(rows[0].fga, 2);
    assert.equal(rows[0].plus_minus, 3);
    assert.ok(isIndexed("0029900001"));
  });

  it("stops at a date", () => {
    indexGame(game("0029900001", "1999-11-01", 95, 99, [[1, HOME, "28:00", 18]]));
    indexGame(game("0029900002", "1999-11-03", 100, 90, [[1, HOME, "30:15", 22]]));

    assert.equal(playerGames(1, SEASON, "1999-11-02").length, 1);
    assert.equal(playerGames(1, SEASON, "1999-11-03").length, 2);
    assert.equal(gamesThrough(SEASON, "1999-11-02"), 1);
  });

  it("leaves out players who didn't play", () => {
    indexGame(game("0029900001", "1999-11-01", 95, 99, [[1, HOME, "28:00", 18], [3, HOME, "", 0], [4, HOME, null, 0]]));

    assert.deepEqual([1, 3, 4].map((id) => playerGames(id, SEASON).length), [1, 0, 0]);
  });

  it("adds up shots by zone, for a player or the league", () => {
    const shot = (playerId, zone, made) => ({ player_id: playerId, team_id: HOME, zone, made });
    indexGame(game("0029900001", "1999-11-01", 95, 99, [[1, HOME, "28:00", 18]], [
      shot(1, "Restricted Area|Center(C)", true),
      shot(1, "Restricted Area|Center(C)", false),
      shot(2, "Restricted Area|Center(C)", true),
      shot(2, "Left Corner 3|Left Side(L)", false),
    ]));

    assert.deepEqual(zonesThrough(SEASON, null, 1), { "Restricted Area|Center(C)": { fgm: 1, fga: 2 } });
    assert.deepEqual(zonesThrough(SEASON), {
      "Restricted Area|Center(C)": { fgm: 2, fga: 3 },
      "Left Corner 3|Left Side(L)": { fgm: 0, fga: 1 },
    });
    assert.deepEqual(zonesThrough(SEASON, "1999-10-31"), {});
  });

  it("replaces a game indexed again", () => {
    indexGame(game("0029900001", "1999-11-01", 95, 99, [[1, HOME, "28:00", 18]]));
    indexGame(game("0029900001", "1999-11-01", 95, 99, [[1, HOME, "28:00", 20]]));

    assert.deepEqual(playerGames(1, SEASON).map((r) => r.pts), [20]);
    assert.equal(indexStats().find((row) => row.season === SEASON).games, 1);
  });

  it("empties a season", () => {
    indexGame(game("0029900001", "1999-11-01", 95, 99, [[1, HOME, "28:00", 18]]));
    clearIndex(SEASON);

    assert.equal(playerGames(1, SEASON).length, 0);
    assert.ok(!isIndexed("0029900001"));
  });
});
