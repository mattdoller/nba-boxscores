import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeSeason, seededRandom } from "../../dev/fake-season.js";
import { getTeams } from "../../nba-api/static/teams.js";
import { ZONE_NAMES } from "../../public/lib/zones.js";

// Rows of a stats.nba.com result set, as objects.
function rows(json, name) {
  const set = json.resultSets.find((s) => s.name === name);
  return set.rowSet.map((row) => Object.fromEntries(set.headers.map((h, i) => [h, row[i]])));
}

describe("seededRandom", () => {
  it("makes the same numbers for the same seed", () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    const c = seededRandom(6);
    const first = [a(), a(), a()];

    assert.deepEqual(first, [b(), b(), b()]);
    assert.notDeepEqual(first, [c(), c(), c()]);
    assert.ok(first.every((n) => n >= 0 && n < 1));
  });
});

describe("fakeSeason", () => {
  const season = fakeSeason({ season: 2025, gamesPerTeam: 4, seed: 3 });
  const games = [...season.byGame.entries()];

  it("gives every team its games, with fake ids past any real season's", () => {
    assert.equal(games.length, 4 * 15);
    for (const team of getTeams()) {
      const log = rows(season.teamgamelog.get(team.id), "TeamGameLog");
      assert.equal(log.length, 4);
      assert.ok(log.every((g) => g.Team_ID === team.id && /^[A-Z]{3} \d{1,2}, 2025$/.test(g.GAME_DATE)));
    }
    assert.ok(games.every(([id]) => /^0022509\d{3}$/.test(id)));
  });

  it("makes the same season from the same seed", () => {
    const again = fakeSeason({ season: 2025, gamesPerTeam: 4, seed: 3 });

    assert.deepEqual([...again.byGame.values()].map((g) => g.score), games.map(([, g]) => g.score));
  });

  it("keeps each game's box score, line score, play-by-play, and shots in agreement", () => {
    for (const [id, game] of games) {
      const summary = game.boxscoresummaryv3.boxScoreSummary;
      const box = game.boxscoretraditionalv3.boxScoreTraditional;
      const actions = game.playbyplayv3.game.actions;
      const shots = rows(game.shotchartdetail, "Shot_Chart_Detail");

      for (const side of ["homeTeam", "awayTeam"]) {
        const final = summary[side].score;
        assert.equal(box[side].players.reduce((sum, p) => sum + p.statistics.points, 0), final, `${id} ${side} box`);
        assert.equal(summary[side].periods.reduce((sum, p) => sum + p.score, 0), final, `${id} ${side} periods`);
      }
      assert.notEqual(summary.homeTeam.score, summary.awayTeam.score, `${id} ends tied`);
      assert.equal(Number(actions.at(-1).scoreHome), summary.homeTeam.score, `${id} play-by-play`);
      assert.equal(Number(actions.at(-1).scoreAway), summary.awayTeam.score, `${id} play-by-play`);

      const attempts = box.homeTeam.statistics.fieldGoalsAttempted + box.awayTeam.statistics.fieldGoalsAttempted;
      assert.equal(shots.length, attempts, `${id} shots`);
      const fieldGoals = new Map(actions.filter((a) => a.isFieldGoal === 1).map((a) => [a.actionNumber, a]));
      for (const shot of shots) {
        const action = fieldGoals.get(shot.GAME_EVENT_ID);
        assert.equal(action?.personId, shot.PLAYER_ID, `${id} shot ${shot.GAME_EVENT_ID} has its play`);
        assert.ok(`${shot.SHOT_ZONE_BASIC}|${shot.SHOT_ZONE_AREA}` in ZONE_NAMES, `${id} shot zone`);
        assert.equal(shot.SHOT_TYPE.startsWith("3PT"), shot.SHOT_ZONE_BASIC.includes("3"), `${id} shot value`);
      }
    }
  });

  it("keeps players' names unique across the league", () => {
    const names = new Map();
    for (const [, game] of games) {
      const box = game.boxscoretraditionalv3.boxScoreTraditional;
      for (const team of [box.homeTeam, box.awayTeam]) {
        for (const p of team.players) {
          names.set(`${p.firstName} ${p.familyName}`, p.personId);
        }
      }
    }

    assert.equal(names.size, new Set(names.values()).size);
  });

  it("scores like the NBA, roughly", () => {
    const scores = games.flatMap(([, g]) => [g.score.home, g.score.away]);
    const average = scores.reduce((sum, s) => sum + s, 0) / scores.length;

    assert.ok(average > 100 && average < 130, `averaged ${average}`);
  });

  it("gives every player a career whose simulated season matches their box scores", () => {
    assert.equal(season.players.size, 30 * 13);
    for (const [id, { career, shotCharts }] of season.players) {
      const seasons = rows(career, "SeasonTotalsRegularSeason");
      assert.ok(seasons.length >= 1, `${id} has a season`);

      const lines = games.flatMap(([, g]) => {
        const box = g.boxscoretraditionalv3.boxScoreTraditional;
        return [...box.homeTeam.players, ...box.awayTeam.players].filter((p) => p.personId === id && p.statistics.minutes);
      });
      const current = seasons.find((s) => s.SEASON_ID === "2025-26");
      assert.equal(current?.GP ?? 0, lines.length, `${id} games`);
      if (current) {
        assert.equal(current.PTS, lines.reduce((sum, p) => sum + p.statistics.points, 0), `${id} points`);
      }

      for (const s of seasons) {
        const shots = rows(shotCharts.get(Number(s.SEASON_ID.slice(0, 4))), "Shot_Chart_Detail");
        assert.equal(shots.length, s.FGA, `${id} ${s.SEASON_ID} shots`);
        assert.equal(shots.filter((shot) => shot.SHOT_MADE_FLAG === 1).length, s.FGM, `${id} ${s.SEASON_ID} makes`);
      }
      const [total] = rows(career, "CareerTotalsRegularSeason");
      assert.equal(total.PTS, seasons.reduce((sum, s) => sum + s.PTS, 0), `${id} career points`);
    }
  });

  it("gives the league team stats that add up to its games, for every career season", () => {
    const [team] = rows(season.league.get(2025), "LeagueDashTeamStats");
    const own = games.filter(([, g]) => [g.home, g.away].includes(getTeams().find((t) => t.id === team.TEAM_ID).abbreviation));
    const points = own.reduce((sum, [, g]) => {
      const summary = g.boxscoresummaryv3.boxScoreSummary;
      return sum + (summary.homeTeamId === team.TEAM_ID ? summary.homeTeam.score : summary.awayTeam.score);
    }, 0);

    assert.equal(team.GP, own.length);
    assert.equal(team.PTS, points);
    assert.ok(team.MIN >= team.GP * 48);
    assert.deepEqual([...season.league.keys()], [2025, 2024, 2023, 2022, 2021]);
  });

  it("gives the league a game log with each team's side of every game", () => {
    const log = rows(season.leagueGameLog.get(2025), "LeagueGameLog");

    assert.equal(log.length, games.length * 2);
    assert.deepEqual(log.map((row) => row.GAME_DATE), log.map((row) => row.GAME_DATE).sort());
    for (const [id, g] of games) {
      const [home, away] = [g.home, g.away].map((abbr) => log.find((row) => row.GAME_ID === id && row.TEAM_ABBREVIATION === abbr));
      assert.equal(home.MATCHUP, `${g.home} vs. ${g.away}`);
      assert.equal(away.MATCHUP, `${g.away} @ ${g.home}`);
      assert.deepEqual([home.PTS, away.PTS], [g.score.home, g.score.away]);
      assert.equal(home.PLUS_MINUS, -away.PLUS_MINUS);
      assert.equal(home.WL === "W", g.score.home > g.score.away);
    }
  });

  it("gives every team a history whose last season is its record so far", () => {
    const team = getTeams()[0];
    const history = rows(season.teamHistories.get(team.id), "TeamStats");
    const log = rows(season.leagueGameLog.get(2025), "LeagueGameLog").filter((row) => row.TEAM_ID === team.id);

    assert.deepEqual(history.map((row) => row.YEAR), ["2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]);
    const latest = history.at(-1);
    assert.deepEqual([latest.WINS, latest.LOSSES], [log.filter((g) => g.WL === "W").length, log.filter((g) => g.WL === "L").length]);
    assert.ok(history.slice(0, -1).every((row) => row.WINS + row.LOSSES === 82));
  });

  it("crowns one champion a season", () => {
    for (const year of ["2021-22", "2024-25"]) {
      const champions = [...season.teamHistories.values()]
        .flatMap((json) => rows(json, "TeamStats"))
        .filter((row) => row.YEAR === year && row.NBA_FINALS_APPEARANCE === "LEAGUE CHAMPION");
      assert.equal(champions.length, 1, year);
    }
  });

  it("gives every team a season shot chart of its games' shots", () => {
    const team = getTeams()[0];
    const chart = season.teamShotCharts.get(team.id);
    const shots = rows(chart, "Shot_Chart_Detail");
    const fromGames = games.flatMap(([, g]) => rows(g.shotchartdetail, "Shot_Chart_Detail")).filter((shot) => shot.TEAM_ID === team.id);

    assert.equal(shots.length, fromGames.length);
    assert.ok(shots.every((shot) => shot.TEAM_ID === team.id));
    assert.ok(rows(chart, "LeagueAverages").length > 0);
    assert.equal(season.teamShotCharts.size, getTeams().length);
  });
});
