import express from "express";
import {
  ContextMeasure,
  SeasonType,
  boxScoreSummaryV3,
  boxScoreTraditionalV3,
  findTeamById,
  getTeams,
  leagueDashTeamStats,
  playByPlayV3,
  playerCareerStats,
  seasonFromGameId,
  seasonString,
  seasonTypeFromGameId,
  setOffline,
  shotChartDetail,
  teamGameLog,
} from "./nba-api/index.js";
import { hasFixtures, seasonsWithGames } from "./nba-api/cache.js";
import { currentSeason, periodLabel } from "./public/lib/format.js";
import { teamColors } from "./team-colors.js";

const PORT = process.env.PORT || 3000;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Game logs use dates like "APR 13, 2025"; convert to "2025-04-13".
export function isoDate(gameDate) {
  const [, mon, day, year] = gameDate.match(/^(\w{3}) (\d{1,2}), (\d{4})$/);
  const month = String(MONTHS.indexOf(mon.toUpperCase()) + 1).padStart(2, "0");
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

// Play-by-play clocks are ISO 8601 durations like "PT11M42.00S"; show "11:42".
export function gameClock(clock) {
  const match = /PT(\d+)M([\d.]+)S/.exec(clock ?? "");
  if (!match) {
    return "";
  }

  const seconds = Math.floor(Number(match[2]));
  return `${Number(match[1])}:${String(seconds).padStart(2, "0")}`;
}

// stats.nba.com's gameStatus: 1 scheduled, 2 in progress, 3 final.
const GAME_FINAL = 3;

// Until a game is final its responses keep changing, so they're only cached
// this long. Final games' responses are cached forever.
export const LIVE_TTL_MS = 60_000;

function isLive(status) {
  return status != null && status !== GAME_FINAL;
}

// The summary's cache TTL, from the status it reports. A summary without a
// status is treated as final.
function summaryTtl(json) {
  if (isLive(json.boxScoreSummary?.gameStatus)) {
    return LIVE_TTL_MS;
  }

  return Infinity;
}

// A game's summary, cached by its status, or null when it can't be fetched.
async function gameSummary(gameId) {
  try {
    return await boxScoreSummaryV3({ gameId }, { ttlMs: summaryTtl });
  } catch {
    return null;
  }
}

// Cache options for a game's other responses, by the status in its summary.
// A game whose summary couldn't be fetched is treated as final.
function gameCacheOptions(summary) {
  if (isLive(summary?.GameSummary[0]?.gameStatus)) {
    return { ttlMs: LIVE_TTL_MS };
  }

  return {};
}

function isPostseason(gameId) {
  return seasonTypeFromGameId(gameId) !== SeasonType.regular;
}

function teamSummary(teamStats, lineScore) {
  return {
    id: teamStats.teamId,
    abbreviation: teamStats.teamTricode,
    full_name: findTeamById(teamStats.teamId)?.full_name ?? `${teamStats.teamCity} ${teamStats.teamName}`,
    score: lineScore?.score ?? teamStats.points,
    colors: teamColors(teamStats.teamId),
    periods: (lineScore?.periods ?? []).map((p) => ({ label: periodLabel(p.period), score: p.score })),
  };
}

// Where a game was played, from its summary, or null when that's unknown.
function venue(info) {
  if (!info?.arenaName) {
    return null;
  }

  return {
    name: info.arenaName,
    city: info.arenaCity || null,
    state: info.arenaState || null,
    country: info.arenaCountry || null,
  };
}

function playerStats(p) {
  return {
    team_id: p.teamId,
    player_id: p.personId,
    // Some older games have no stats for some (or all) players.
    recorded: p.minutes != null || p.points != null,
    first_name: p.firstName,
    last_name: p.familyName,
    position: p.position,
    comment: p.comment,
    min: p.minutes,
    pts: p.points,
    reb: p.reboundsTotal,
    ast: p.assists,
    stl: p.steals,
    blk: p.blocks,
    turnover: p.turnovers,
    pf: p.foulsPersonal,
    fgm: p.fieldGoalsMade,
    fga: p.fieldGoalsAttempted,
    fg3m: p.threePointersMade,
    fg3a: p.threePointersAttempted,
    ftm: p.freeThrowsMade,
    fta: p.freeThrowsAttempted,
    plus_minus: p.plusMinusPoints,
  };
}

function requireGameId(req, res, next) {
  if (!/^\d{10}$/.test(req.query.game_id ?? "")) {
    return res.status(400).json({ error: "game_id must be a 10-digit NBA game id." });
  }

  next();
}

// The league's first season was 1946–47.
const FIRST_SEASON = 1946;

function requireTeamAndSeason(req, res, next) {
  const { team_id, season } = req.query;
  if (!/^\d+$/.test(team_id ?? "") || !findTeamById(team_id)) {
    return res.status(400).json({ error: "team_id must be the id of a current NBA team." });
  }
  if (!/^\d{4}$/.test(season ?? "") || Number(season) < FIRST_SEASON || Number(season) > currentSeason()) {
    return res.status(400).json({ error: `season must be a year from ${FIRST_SEASON} to ${currentSeason()}.` });
  }

  next();
}

export const app = express();
app.use(express.static("public"));

// About the data being served: whether it's the fake games from
// bin/load-fixtures rather than stats.nba.com's, and whether the server is
// offline. Offline, it can only show seasons it has games for, so those are
// listed too (null when it can fetch any season).
app.get("/api/info", (req, res) => {
  const offline = offlineReason() !== null;
  let seasons = null;
  if (offline) {
    seasons = seasonsWithGames();
  }
  res.json({ fixtures: hasFixtures(), offline, seasons });
});

app.get("/api/teams", (req, res) => {
  res.json(getTeams().map((t) => ({ ...t, colors: teamColors(t.id) })));
});

// Completed games for a team in a season, used to mark playable dates on the calendar.
app.get("/api/games", requireTeamAndSeason, async (req, res) => {
  const { team_id, season } = req.query;
  // Past seasons never change; refresh the current one periodically.
  const options = Number(season) === currentSeason() ? { ttlMs: 15 * 60_000 } : {};

  // Play-in games only exist from 2020–21 on; the endpoint returns nothing before that.
  const logs = await Promise.all(
    [SeasonType.regular, SeasonType.playIn, SeasonType.playoffs].map((seasonType) => teamGameLog(
      { teamId: team_id, season, seasonType },
      options,
    )),
  );

  res.json(
    logs.flatMap((log) => log.TeamGameLog ?? [])
      .map((g) => ({
        id: g.Game_ID,
        date: isoDate(g.GAME_DATE),
        matchup: g.MATCHUP,
        result: g.WL,
        postseason: isPostseason(g.Game_ID),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  );
});

// Line score and per-player stats for one game.
app.get("/api/boxscore", requireGameId, async (req, res) => {
  const { game_id } = req.query;
  // The summary comes first: whether the game is final decides how long the
  // box score is cached.
  const summary = await gameSummary(game_id);
  const { PlayerStats, TeamStats } = await boxScoreTraditionalV3({ gameId: game_id }, gameCacheOptions(summary));
  if (PlayerStats.length === 0) {
    return res.status(404).json({ error: "stats.nba.com has no box score for this game." });
  }

  // The summary only adds status and the period-by-period line score, so tolerate it failing.
  const { GameSummary = [], LineScore = [] } = summary ?? {};
  const info = GameSummary[0];
  const side = (teamId) => teamSummary(
    TeamStats.find((t) => t.teamId === teamId),
    LineScore.find((l) => l.teamId === teamId),
  );
  const { homeTeamId, awayTeamId } = TeamStats[0];

  res.json({
    game: {
      id: game_id,
      date: info?.gameEt?.slice(0, 10) ?? req.query.date,
      status: info?.gameStatusText?.trim() || "Final",
      postseason: isPostseason(game_id),
      venue: venue(info),
      attendance: info?.attendance || null,
      sellout: info?.sellout === 1,
      home: side(homeTeamId),
      away: side(awayTeamId),
    },
    stats: PlayerStats.map(playerStats),
  });
});

// The score after each play, carried forward through non-scoring plays.
// Those can carry "", null, or "0" in scoreHome/scoreAway, so a play's score
// is only taken when both sides are numbers and neither is below the running
// score (scores never go down). A play scored if the total went up, by
// `points`.
export function withRunningScore(actions) {
  let score = { home: 0, away: 0 };
  return actions.map((action) => {
    const home = Number.parseInt(action.scoreHome, 10);
    const away = Number.parseInt(action.scoreAway, 10);
    let points = 0;
    if (Number.isFinite(home) && Number.isFinite(away) && home >= score.home && away >= score.away) {
      points = home + away - (score.home + score.away);
      score = { home, away };
    }
    return { action, score, scored: points > 0, points };
  });
}

// Actions that never change who has the ball, and are skipped when looking
// at what follows a made shot.
const BOOKKEEPING = new Set(["Substitution", "Timeout", "Instant Replay", ""]);

// Flagrant and clear-path fouls give the fouled team its free throws and
// then the ball back.
const RETAINED_FREE_THROWS = /Flagrant|Clear Path/i;

// The team (tricode) with the ball after each action, or null when unknown
// (before the opening tip, and between periods until someone has the ball).
// stats.nba.com doesn't record possession, so it's followed from the plays
// that change it: made shots (except and-ones, until the free throw), last
// free throws made, rebounds, turnovers, and jump balls.
export function withPossession(actions) {
  const teams = [...new Set(actions.map((a) => a.teamTricode).filter(Boolean))];
  const other = (team) => teams.find((t) => t !== team) ?? null;
  let ball = null;

  return actions.map((a, i) => {
    const team = a.teamTricode || null;
    switch (a.actionType) {
      case "period":
        if (a.subType === "end") {
          ball = null;
        }
        break;
      case "Jump Ball": {
        // "Jump Ball Queta vs. Looney: Tip to Fears": whoever it was tipped to.
        const name = /Tip to (.+)$/.exec(a.description ?? "")?.[1]?.trim();
        const tippedTo = actions.find((n) => n.playerName === name && n.teamTricode);
        ball = tippedTo?.teamTricode ?? team ?? ball;
        break;
      }
      case "Made Shot": {
        const next = actions.slice(i + 1).find((n) => !BOOKKEEPING.has(n.actionType ?? ""));
        const andOne = next?.actionType === "Foul" && next.subType === "Shooting" && next.teamTricode !== team;
        ball = team;
        if (!andOne) {
          ball = other(team);
        }
        break;
      }
      case "Missed Shot":
      case "Heave":
        ball = team;
        break;
      case "Free Throw": {
        // Either team can shoot a technical, and play resumes with whoever
        // had the ball.
        if (/Technical/i.test(a.subType ?? "")) {
          break;
        }

        ball = team;
        const [, n, of] = /(\d) of (\d)/.exec(a.subType ?? "") ?? [];
        const last = n !== undefined && n === of;
        // A missed last free throw is settled by the rebound.
        const missed = (a.description ?? "").startsWith("MISS");
        if (last && !missed && !RETAINED_FREE_THROWS.test(a.subType ?? "")) {
          ball = other(team);
        }
        break;
      }
      case "Rebound":
        // Offensive or defensive, the rebounding team has the ball.
        if (team) {
          ball = team;
        }
        break;
      case "Turnover":
        if (team) {
          ball = other(team);
        }
        break;
    }
    return ball;
  });
}

// Every play in the game, with the running score on each and who has the
// ball after it. Scoring plays carry the scorer and how many points they
// scored.
app.get("/api/playbyplay", requireGameId, async (req, res) => {
  const { game_id } = req.query;
  const options = gameCacheOptions(await gameSummary(game_id));
  const { PlayByPlay } = await playByPlayV3({ gameId: game_id }, options);
  const possession = withPossession(PlayByPlay);

  res.json(withRunningScore(PlayByPlay).map(({ action: a, score, scored, points }, i) => {
    return {
      id: a.actionNumber,
      period: a.period,
      period_label: periodLabel(a.period),
      clock: gameClock(a.clock),
      team: a.teamTricode || null,
      player: a.playerNameI || null,
      player_id: a.personId || null,
      description: a.description,
      scored,
      points,
      score,
      possession: possession[i],
    };
  }));
});

// Seconds left in the period, from a play-by-play clock like "PT11M42.50S".
export function clockSeconds(clock) {
  const match = /PT(\d+)M([\d.]+)S/.exec(clock ?? "");
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Math.floor(Number(match[2]));
}

// Finds the play-by-play action for a shot chart row. GAME_EVENT_ID usually
// matches the action's number, so try that first; otherwise fall back to the
// same shooter, period, and game clock.
export function findShotAction(shot, actions) {
  const candidates = actions.filter((a) => a.isFieldGoal === 1
    && a.personId === shot.PLAYER_ID
    && a.period === shot.PERIOD);
  const seconds = shot.MINUTES_REMAINING * 60 + shot.SECONDS_REMAINING;
  return candidates.find((a) => a.actionNumber === shot.GAME_EVENT_ID)
    ?? candidates.find((a) => a.actionId === shot.GAME_EVENT_ID)
    ?? candidates.find((a) => clockSeconds(a.clock) === seconds);
}

// The shot zone a shot chart row (or league average) is in, keyed like
// "Mid-Range|Left Side(L)": stats.nba.com's basic zone and area. Null when
// the row has no zone.
export function shotZone(row) {
  if (!row.SHOT_ZONE_BASIC) {
    return null;
  }

  return `${row.SHOT_ZONE_BASIC}|${row.SHOT_ZONE_AREA}`;
}

// A game's shot chart: every attempt, plus league averages by zone for the
// season and season type the game is in.
function gameShotChart(gameId, options) {
  return shotChartDetail({
    gameId,
    contextMeasure: ContextMeasure.fga,
    season: seasonFromGameId(gameId),
    seasonType: seasonTypeFromGameId(gameId),
  }, options);
}

// Every field goal attempt in the game, grouped by team, each with the id of
// its play in the play-by-play (null when it can't be matched). Makes include
// the score after the shot.
app.get("/api/shotchart", requireGameId, async (req, res) => {
  const { game_id } = req.query;
  const options = gameCacheOptions(await gameSummary(game_id));
  const [chart, plays] = await Promise.allSettled([
    gameShotChart(game_id, options),
    playByPlayV3({ gameId: game_id }, options),
  ]);
  if (chart.status === "rejected") {
    throw chart.reason;
  }

  // Without the play-by-play the chart still works; makes just lack a score.
  const actions = plays.value?.PlayByPlay ?? [];
  const scores = new Map(withRunningScore(actions).map(({ action, score, scored }) => [action, { score, scored }]));
  const byTeam = {};
  for (const s of chart.value.Shot_Chart_Detail ?? []) {
    const made = s.SHOT_MADE_FLAG === 1;
    const action = findShotAction(s, actions);
    let score = null;
    if (made && action && scores.get(action).scored) {
      score = scores.get(action).score;
    }

    byTeam[s.TEAM_ID] ??= [];
    byTeam[s.TEAM_ID].push({
      player: s.PLAYER_NAME,
      player_id: s.PLAYER_ID,
      period: s.PERIOD,
      period_label: periodLabel(s.PERIOD),
      clock: `${s.MINUTES_REMAINING}:${String(s.SECONDS_REMAINING).padStart(2, "0")}`,
      action: s.ACTION_TYPE,
      type: s.SHOT_TYPE,
      distance: s.SHOT_DISTANCE,
      x: s.LOC_X,
      y: s.LOC_Y,
      made,
      score,
      play_id: action?.actionNumber ?? null,
      zone: shotZone(s),
    });
  }
  res.json(byTeam);
});

// Fetches and caches everything a game's page asks for, with the same
// requests the routes above make, so bin/backfill and bin/load-fixtures fill
// exactly the cache entries the routes read. The summary comes first, since
// it decides how long the rest are kept.
export async function cacheGame(gameId) {
  const summary = await boxScoreSummaryV3({ gameId }, { ttlMs: summaryTtl });
  const options = gameCacheOptions(summary);
  await Promise.all([
    boxScoreTraditionalV3({ gameId }, options),
    playByPlayV3({ gameId }, options),
    gameShotChart(gameId, options),
  ]);
}

// Makes and attempts by shot zone, { "Mid-Range|Left Side(L)": { fgm, fga } },
// from shot chart rows (one per shot) or LeagueAverages rows (totals, which
// split some zones by distance; those are added together).
export function zoneTotals(rows) {
  const zones = {};
  for (const row of rows) {
    const zone = shotZone(row);
    if (zone) {
      zones[zone] ??= { fgm: 0, fga: 0 };
      if ("FGA" in row) {
        zones[zone].fgm += row.FGM;
        zones[zone].fga += row.FGA;
      } else {
        zones[zone].fgm += row.SHOT_MADE_FLAG;
        zones[zone].fga += 1;
      }
    }
  }
  return zones;
}

// League-wide makes and attempts by shot zone, for the season and season
// type the game is in.
app.get("/api/shotzones", requireGameId, async (req, res) => {
  const { game_id } = req.query;
  const options = gameCacheOptions(await gameSummary(game_id));
  const { LeagueAverages = [] } = await gameShotChart(game_id, options);
  res.json(zoneTotals(LeagueAverages));
});

// A season still being played keeps changing, so a player's numbers that
// include it are only cached this long. Finished seasons are cached forever.
export const CURRENT_SEASON_TTL_MS = 6 * 60 * 60_000;

// Shot charts by player only go back to 1996-97.
const FIRST_SHOT_SEASON = 1996;

function requirePlayerId(req, res, next) {
  if (!/^\d{1,10}$/.test(req.query.player_id ?? "")) {
    return res.status(400).json({ error: "player_id must be an NBA player id." });
  }

  next();
}

function careerTtl(json) {
  const current = seasonString(currentSeason());
  const seasons = json.resultSets?.find((s) => s.name === "SeasonTotalsRegularSeason");
  const seasonColumn = seasons?.headers.indexOf("SEASON_ID") ?? -1;
  if (seasons?.rowSet.some((row) => row[seasonColumn] === current)) {
    return CURRENT_SEASON_TTL_MS;
  }

  return Infinity;
}

function careerStats(playerId) {
  return playerCareerStats({ playerId }, { ttlMs: careerTtl });
}

// Every shot a player took in a regular season, with the league's averages
// by zone that season.
function playerShotChart(playerId, season) {
  let ttlMs = Infinity;
  if (season === currentSeason()) {
    ttlMs = CURRENT_SEASON_TTL_MS;
  }
  return shotChartDetail({
    playerId,
    season,
    seasonType: SeasonType.regular,
    contextMeasure: ContextMeasure.fga,
  }, { ttlMs });
}

function totalsFrom(row) {
  return {
    gp: row.GP,
    gs: row.GS,
    min: row.MIN,
    pts: row.PTS,
    reb: row.REB,
    oreb: row.OREB,
    dreb: row.DREB,
    ast: row.AST,
    stl: row.STL,
    blk: row.BLK,
    tov: row.TOV,
    pf: row.PF,
    fgm: row.FGM,
    fga: row.FGA,
    fg3m: row.FG3M,
    fg3a: row.FG3A,
    ftm: row.FTM,
    fta: row.FTA,
  };
}

// One row per season, oldest first. A season split across teams uses its
// total row (TEAM_ID 0) and lists the teams, like "BOS/LAL".
export function careerSeasons(rows) {
  const bySeason = new Map();
  for (const row of rows) {
    const season = Number(String(row.SEASON_ID).slice(0, 4));
    bySeason.set(season, [...(bySeason.get(season) ?? []), row]);
  }
  return [...bySeason]
    .sort(([a], [b]) => a - b)
    .map(([season, seasonRows]) => {
      const teams = seasonRows.filter((r) => r.TEAM_ID !== 0);
      const total = seasonRows.find((r) => r.TEAM_ID === 0) ?? teams[0];
      return {
        season,
        team: teams.map((r) => r.TEAM_ABBREVIATION).join("/"),
        age: total.PLAYER_AGE,
        ...totalsFrom(total),
      };
    });
}

// A player's regular-season career: season totals (see careerSeasons) and
// career totals.
app.get("/api/player", requirePlayerId, async (req, res) => {
  const { player_id } = req.query;
  const { SeasonTotalsRegularSeason = [], CareerTotalsRegularSeason = [] } = await careerStats(player_id);
  if (SeasonTotalsRegularSeason.length === 0) {
    return res.status(404).json({ error: "stats.nba.com has no regular-season stats for this player." });
  }

  let career = null;
  if (CareerTotalsRegularSeason[0]) {
    career = totalsFrom(CareerTotalsRegularSeason[0]);
  }
  res.json({ id: Number(player_id), seasons: careerSeasons(SeasonTotalsRegularSeason), career });
});

// A player's makes and attempts by shot zone in a regular season, with the
// league's that season: { season, zones, league }, each zone { fgm, fga }.
app.get("/api/playerzones", requirePlayerId, async (req, res) => {
  const { player_id } = req.query;
  const season = Number(req.query.season);
  if (!/^\d{4}$/.test(req.query.season ?? "") || season < FIRST_SHOT_SEASON || season > currentSeason()) {
    return res.status(400).json({ error: `season must be a year from ${FIRST_SHOT_SEASON} (when shot data starts) to ${currentSeason()}.` });
  }

  const { Shot_Chart_Detail = [], LeagueAverages = [] } = await playerShotChart(player_id, season);
  res.json({ season, zones: zoneTotals(Shot_Chart_Detail), league: zoneTotals(LeagueAverages) });
});

// The league's regular-season totals for a season, added up from its teams'.
// Minutes are counted per player, five on the floor at once, so the league's
// per-minute rates compare with a player's. Team stats, like shot charts,
// only go back to 1996-97.
async function leagueTotals(season) {
  let ttlMs = Infinity;
  if (season === currentSeason()) {
    ttlMs = CURRENT_SEASON_TTL_MS;
  }
  const { LeagueDashTeamStats: teams = [] } = await leagueDashTeamStats({ season }, { ttlMs });
  const sum = (key) => teams.reduce((total, team) => total + (team[key] ?? 0), 0);
  return {
    season,
    teams: teams.length,
    min: sum("MIN") * 5,
    pts: sum("PTS"),
    reb: sum("REB"),
    oreb: sum("OREB"),
    dreb: sum("DREB"),
    ast: sum("AST"),
    stl: sum("STL"),
    blk: sum("BLK"),
    tov: sum("TOV"),
    pf: sum("PF"),
    fgm: sum("FGM"),
    fga: sum("FGA"),
    fg3m: sum("FG3M"),
    fg3a: sum("FG3A"),
    ftm: sum("FTM"),
    fta: sum("FTA"),
  };
}

// The league's totals for some regular seasons, to compare players' stats
// with: `seasons` is a comma-separated list, and the response has each
// season's totals by year. A player card asks for its whole career at once.
// Seasons not cached yet are fetched one at a time, to go easy on
// stats.nba.com, and one that can't be loaded is null rather than failing
// the rest.
app.get("/api/league", async (req, res) => {
  const years = (req.query.seasons ?? "").split(",");
  const valid = (year) => /^\d{4}$/.test(year) && Number(year) >= FIRST_SHOT_SEASON && Number(year) <= currentSeason();
  if (!years.every(valid)) {
    return res.status(400).json({ error: `seasons must be years from ${FIRST_SHOT_SEASON} (when team stats start) to ${currentSeason()}, separated by commas.` });
  }

  const totals = {};
  for (const season of new Set(years.map(Number))) {
    try {
      totals[season] = await leagueTotals(season);
    } catch (err) {
      console.error(`League totals for ${season}: ${err.message}`);
      totals[season] = null;
    }
  }
  res.json(totals);
});

// Caches everything a player's card asks for: their career, and for each
// season with shot data, their shot chart and the league's totals.
// bin/load-fixtures uses it to cache the fake players under the same
// requests the routes make.
export async function cachePlayer(playerId) {
  const { SeasonTotalsRegularSeason = [] } = await careerStats(playerId);
  for (const { season } of careerSeasons(SeasonTotalsRegularSeason)) {
    if (season >= FIRST_SHOT_SEASON) {
      await playerShotChart(playerId, season);
      await leagueTotals(season);
    }
  }
}

// Express spots error handlers by their four arguments, so `next` stays.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message });
});

// Tests import the app without starting a listener.
// Why the server won't ask stats.nba.com for what isn't cached, or null if
// it will. A cache of bin/load-fixtures' fake games never mixes in real
// ones; NBA_OFFLINE=1 (bin/server --offline) does the same for any cache.
export function offlineReason() {
  if (hasFixtures()) {
    return "Not in the test data. This server only has bin/load-fixtures' fake games and doesn't ask stats.nba.com.";
  }
  if (process.env.NBA_OFFLINE === "1") {
    return "Not in the cache, and the server is offline (bin/server --offline), so it doesn't ask stats.nba.com.";
  }
  return null;
}

if (import.meta.main) {
  const reason = offlineReason();
  setOffline(reason);
  app.listen(PORT, () => {
    console.log(`NBA box scores running at http://localhost:${PORT}`);
    if (hasFixtures()) {
      console.log("Serving bin/load-fixtures' test data only; stats.nba.com won't be asked for anything.");
    } else if (reason) {
      console.log("Offline: serving only what's cached; stats.nba.com won't be asked for anything.");
    }
  });
}
