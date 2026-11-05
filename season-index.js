// An index of the cached games, for looking across them: a player's season
// up to any date is one query here, instead of parsing every game their team
// played. It lives in the cache's database, beside the responses it's built
// from, and only holds final regular-season games.
//
//   games         one row per game: date, season, teams, and score
//   player_games  one row per player per game: their box score line
//   shots         one row per shot: who took it, in which zone, and whether
//                 it went in
//
// The server indexes a game once it's cached and final (see indexCachedGame
// in server.js); bin/index indexes what's already in the cache.
import { database } from "./nba-api/cache.js";

const db = database();
db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    game_id TEXT PRIMARY KEY,
    season INTEGER NOT NULL,
    date TEXT NOT NULL,
    home_id INTEGER NOT NULL,
    away_id INTEGER NOT NULL,
    home_pts INTEGER NOT NULL,
    away_pts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS player_games (
    game_id TEXT NOT NULL,
    player_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    season INTEGER NOT NULL,
    date TEXT NOT NULL,
    starter INTEGER NOT NULL,
    seconds INTEGER NOT NULL,
    pts INTEGER, reb INTEGER, oreb INTEGER, dreb INTEGER, ast INTEGER, stl INTEGER, blk INTEGER,
    tov INTEGER, pf INTEGER, fgm INTEGER, fga INTEGER, fg3m INTEGER, fg3a INTEGER, ftm INTEGER, fta INTEGER,
    plus_minus INTEGER,
    PRIMARY KEY (game_id, player_id)
  );
  CREATE INDEX IF NOT EXISTS player_games_by_player ON player_games (player_id, season, date);
  CREATE TABLE IF NOT EXISTS shots (
    game_id TEXT NOT NULL,
    player_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    season INTEGER NOT NULL,
    date TEXT NOT NULL,
    zone TEXT,
    made INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS shots_by_player ON shots (player_id, season, date);
  CREATE INDEX IF NOT EXISTS shots_by_season ON shots (season, date);
`);

const STATS = ["pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta"];

// "34:12" (or "PT34M12.00S") -> 2052 seconds; null for a player who didn't play.
function seconds(minutes) {
  const match = /^(?:PT)?(\d+)[:M](\d+)/.exec(minutes ?? "");
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

const insertGame = db.prepare(`
  INSERT INTO games (game_id, season, date, home_id, away_id, home_pts, away_pts) VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertPlayerGame = db.prepare(`
  INSERT INTO player_games (game_id, player_id, team_id, season, date, starter, seconds, ${STATS.join(", ")}, plus_minus)
  VALUES (${Array(7 + STATS.length + 1).fill("?").join(", ")})
`);
const insertShot = db.prepare(`
  INSERT INTO shots (game_id, player_id, team_id, season, date, zone, made) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// Adds a game to the index, replacing it if it's there: `players` are the
// box score's PlayerStats and `teams` its TeamStats, `shots` are
// { player_id, team_id, zone, made }. Players who didn't play are left out.
export function indexGame({ gameId, season, date, players, teams, shots }) {
  const home = teams.find((t) => t.teamId === t.homeTeamId);
  const away = teams.find((t) => t.teamId === t.awayTeamId);
  db.exec("BEGIN");
  try {
    removeGame(gameId);
    insertGame.run(gameId, season, date, home.teamId, away.teamId, home.points, away.points);
    for (const p of players) {
      const played = seconds(p.minutes);
      if (!played) {
        continue;
      }
      insertPlayerGame.run(
        gameId,
        p.personId,
        p.teamId,
        season,
        date,
        p.position ? 1 : 0,
        played,
        ...STATS.map((key) => p[PLAYER_STAT_FIELDS[key]] ?? 0),
        p.plusMinusPoints ?? 0,
      );
    }
    for (const shot of shots) {
      insertShot.run(gameId, shot.player_id, shot.team_id, season, date, shot.zone, shot.made ? 1 : 0);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// The box score's field for each stat.
const PLAYER_STAT_FIELDS = {
  pts: "points",
  reb: "reboundsTotal",
  oreb: "reboundsOffensive",
  dreb: "reboundsDefensive",
  ast: "assists",
  stl: "steals",
  blk: "blocks",
  tov: "turnovers",
  pf: "foulsPersonal",
  fgm: "fieldGoalsMade",
  fga: "fieldGoalsAttempted",
  fg3m: "threePointersMade",
  fg3a: "threePointersAttempted",
  ftm: "freeThrowsMade",
  fta: "freeThrowsAttempted",
};

function removeGame(gameId) {
  for (const table of ["games", "player_games", "shots"]) {
    db.prepare(`DELETE FROM ${table} WHERE game_id = ?`).run(gameId);
  }
}

export function isIndexed(gameId) {
  return db.prepare("SELECT 1 FROM games WHERE game_id = ?").get(gameId) !== undefined;
}

// A player's games in a season through a date (inclusive; every game when
// null), oldest first, each with the game's teams and score.
export function playerGames(playerId, season, through = null) {
  return db.prepare(`
    SELECT pg.*, g.home_id, g.away_id, g.home_pts, g.away_pts
    FROM player_games pg JOIN games g USING (game_id)
    WHERE pg.player_id = ? AND pg.season = ? AND pg.date <= ?
    ORDER BY pg.date, pg.game_id
  `).all(playerId, season, through ?? "9999-12-31");
}

// Makes and attempts by zone through a date: one player's, or the whole
// league's when playerId is null. { zone: { fgm, fga } }.
export function zonesThrough(season, through = null, playerId = null) {
  const rows = db.prepare(`
    SELECT zone, SUM(made) AS fgm, COUNT(*) AS fga FROM shots
    WHERE season = ? AND date <= ? AND zone IS NOT NULL ${playerId == null ? "" : "AND player_id = ?"}
    GROUP BY zone
  `).all(...[season, through ?? "9999-12-31", playerId].filter((v) => v != null));
  return Object.fromEntries(rows.map((r) => [r.zone, { fgm: r.fgm, fga: r.fga }]));
}

// How many games the index has for a season through a date.
export function gamesThrough(season, through = null) {
  return db.prepare("SELECT COUNT(*) AS n FROM games WHERE season = ? AND date <= ?").get(season, through ?? "9999-12-31").n;
}

// Games, players' games, and shots in the index, by season, newest first.
export function indexStats() {
  return db.prepare(`
    SELECT season, COUNT(*) AS games,
      (SELECT COUNT(*) FROM player_games pg WHERE pg.season = g.season) AS player_games,
      (SELECT COUNT(*) FROM shots s WHERE s.season = g.season) AS shots
    FROM games g GROUP BY season ORDER BY season DESC
  `).all();
}

// Empties the index, or one season of it.
export function clearIndex(season = null) {
  for (const table of ["games", "player_games", "shots"]) {
    if (season == null) {
      db.prepare(`DELETE FROM ${table}`).run();
    } else {
      db.prepare(`DELETE FROM ${table} WHERE season = ?`).run(season);
    }
  }
}
