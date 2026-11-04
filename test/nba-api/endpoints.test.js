import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boxScoreSummaryV3,
  parseBoxScoreSummaryV3,
} from "../../nba-api/endpoints/boxscoresummaryv3.js";
import {
  boxScoreTraditionalV3,
  parseBoxScoreTraditionalV3,
} from "../../nba-api/endpoints/boxscoretraditionalv3.js";
import { parsePlayByPlayV3, playByPlayV3 } from "../../nba-api/endpoints/playbyplayv3.js";
import { playerCareerStats } from "../../nba-api/endpoints/playercareerstats.js";
import { shotChartDetail } from "../../nba-api/endpoints/shotchartdetail.js";
import { teamGameLog } from "../../nba-api/endpoints/teamgamelog.js";
import { ContextMeasure, SeasonType } from "../../nba-api/parameters.js";
import {
  CELTICS_ID,
  LAKERS_ID,
  action,
  boxScoreSummaryJson,
  boxScoreTraditionalJson,
  playByPlayJson,
} from "../fixtures.js";
import { resultSets, stubStatsApi } from "../helpers.js";

describe("parseBoxScoreTraditionalV3", () => {
  const parsed = parseBoxScoreTraditionalV3(boxScoreTraditionalJson("0022400001"));

  it("flattens each player with game, team, and stat fields", () => {
    const lebron = parsed.PlayerStats.find((p) => p.personId === 2544);

    assert.equal(lebron.gameId, "0022400001");
    assert.equal(lebron.homeTeamId, LAKERS_ID);
    assert.equal(lebron.awayTeamId, CELTICS_ID);
    assert.equal(lebron.teamId, LAKERS_ID);
    assert.equal(lebron.teamTricode, "LAL");
    assert.equal(lebron.familyName, "James");
    assert.equal(lebron.points, 30);
    assert.equal(lebron.minutes, "36:12");
    assert.equal(lebron.statistics, undefined);
  });

  it("lists home players before away players", () => {
    assert.deepEqual(parsed.PlayerStats.map((p) => p.teamTricode), ["LAL", "LAL", "BOS"]);
  });

  it("leaves stats undefined for a player with no statistics", () => {
    const dnp = parsed.PlayerStats.find((p) => p.personId === 1630000);

    assert.equal(dnp.comment, "DNP - Coach's Decision");
    assert.equal(dnp.points, undefined);
    assert.equal(dnp.minutes, undefined);
  });

  it("returns team totals", () => {
    assert.deepEqual(parsed.TeamStats.map((t) => [t.teamTricode, t.points]), [["LAL", 112], ["BOS", 108]]);
  });

  it("splits starters and bench without plus-minus", () => {
    const groups = parsed.TeamStarterBenchStats;

    assert.deepEqual(groups.map((g) => [g.teamTricode, g.startersBench, g.points]), [
      ["LAL", "starters", 82],
      ["LAL", "bench", 30],
      ["BOS", "starters", 78],
      ["BOS", "bench", 30],
    ]);
    assert.ok(groups.every((g) => !("plusMinusPoints" in g)));
  });

  it("returns empty data sets for an empty response", () => {
    assert.deepEqual(parseBoxScoreTraditionalV3({}), {
      PlayerStats: [],
      TeamStats: [],
      TeamStarterBenchStats: [],
    });
  });
});

describe("boxScoreTraditionalV3", () => {
  it("requests the whole game by default", async (t) => {
    const calls = stubStatsApi(t, { boxscoretraditionalv3: boxScoreTraditionalJson("0022400002") });

    const result = await boxScoreTraditionalV3({ gameId: "0022400002" });

    assert.deepEqual(calls[0].params, {
      GameID: "0022400002",
      StartPeriod: "0",
      EndPeriod: "0",
      StartRange: "0",
      EndRange: "0",
      RangeType: "0",
    });
    assert.equal(result.PlayerStats.length, 3);
  });
});

describe("parseBoxScoreSummaryV3", () => {
  const parsed = parseBoxScoreSummaryV3(boxScoreSummaryJson("0022400003"));

  it("returns the game summary", () => {
    const [summary] = parsed.GameSummary;

    assert.equal(summary.gameId, "0022400003");
    assert.equal(summary.gameStatusText, "Final/OT ");
    assert.equal(summary.homeTeamId, LAKERS_ID);
    assert.equal(summary.attendance, 18997);
    assert.equal(summary.arenaName, "Crypto.com Arena");
    assert.equal(summary.arenaCity, "Los Angeles");
    assert.equal(summary.arenaState, "CA");
  });

  it("returns home then away line scores, including overtime periods", () => {
    const [home, away] = parsed.LineScore;

    assert.equal(home.teamTricode, "LAL");
    assert.equal(home.score, 112);
    assert.equal(home.period4Score, 20);
    assert.deepEqual(home.periods.at(-1), { period: 5, score: 10 });
    assert.equal(away.teamTricode, "BOS");
    assert.equal(away.periods.length, 5);
  });

  it("leaves missing quarter scores null", () => {
    const json = boxScoreSummaryJson("0022400003");
    json.boxScoreSummary.homeTeam.periods = [{ period: 1, score: 30 }];
    const [home] = parseBoxScoreSummaryV3(json).LineScore;

    assert.equal(home.period1Score, 30);
    assert.equal(home.period2Score, null);
    assert.equal(home.period4Score, null);
  });

  it("returns no line scores for an empty response", () => {
    assert.deepEqual(parseBoxScoreSummaryV3({}).LineScore, []);
  });
});

describe("boxScoreSummaryV3", () => {
  it("requests the game by id", async (t) => {
    const calls = stubStatsApi(t, { boxscoresummaryv3: boxScoreSummaryJson("0022400004") });

    const result = await boxScoreSummaryV3({ gameId: "0022400004" });

    assert.deepEqual(calls[0].params, { GameID: "0022400004" });
    assert.equal(result.LineScore.length, 2);
  });
});

describe("parsePlayByPlayV3", () => {
  it("keeps the known action fields and adds the game id", () => {
    const json = playByPlayJson("0022400005", [action({ actionNumber: 4, description: "Jump Ball", extra: "x" })]);
    const { PlayByPlay, AvailableVideo } = parsePlayByPlayV3(json);

    assert.deepEqual(AvailableVideo, [{ videoAvailable: 1 }]);
    assert.equal(PlayByPlay.length, 1);
    assert.equal(PlayByPlay[0].gameId, "0022400005");
    assert.equal(PlayByPlay[0].actionNumber, 4);
    assert.equal(PlayByPlay[0].description, "Jump Ball");
    assert.equal(PlayByPlay[0].extra, undefined);
  });

  it("returns no plays for an empty response", () => {
    assert.deepEqual(parsePlayByPlayV3({}).PlayByPlay, []);
  });
});

describe("playByPlayV3", () => {
  it("requests every period by default", async (t) => {
    const calls = stubStatsApi(t, { playbyplayv3: playByPlayJson("0022400006", []) });

    await playByPlayV3({ gameId: "0022400006" });

    assert.deepEqual(calls[0].params, { GameID: "0022400006", StartPeriod: "0", EndPeriod: "0" });
  });
});

describe("shotChartDetail", () => {
  it("sends the season as a label and drops unset optional parameters", async (t) => {
    const calls = stubStatsApi(t, {
      shotchartdetail: resultSets({ Shot_Chart_Detail: [{ GAME_ID: "0022400007", LOC_X: 10 }], LeagueAverages: [] }),
    });

    const result = await shotChartDetail({
      gameId: "0022400007",
      contextMeasure: ContextMeasure.fga,
      season: 2024,
      seasonType: SeasonType.regular,
    });

    const { params } = calls[0];
    assert.equal(params.GameID, "0022400007");
    assert.equal(params.ContextMeasure, "FGA");
    assert.equal(params.Season, "2024-25");
    assert.equal(params.SeasonType, "Regular Season");
    assert.equal(params.TeamID, "0");
    assert.equal(params.DateFrom, "");
    assert.ok(!("ISTRound" in params));
    assert.deepEqual(result.Shot_Chart_Detail, [{ GAME_ID: "0022400007", LOC_X: 10 }]);
  });

  it("sends an empty season when none is given", async (t) => {
    const calls = stubStatsApi(t, { shotchartdetail: resultSets({ Shot_Chart_Detail: [] }) });

    await shotChartDetail({ gameId: "0022400008" });

    assert.equal(calls[0].params.Season, "");
    assert.equal(calls[0].params.ContextMeasure, "PTS");
  });
});

describe("teamGameLog", () => {
  it("requests a team's season and returns its games", async (t) => {
    const games = [{ Team_ID: LAKERS_ID, Game_ID: "0022400009", GAME_DATE: "OCT 22, 2024" }];
    const calls = stubStatsApi(t, { teamgamelog: resultSets({ TeamGameLog: games }) });

    const result = await teamGameLog({ teamId: LAKERS_ID, season: 2024 });

    assert.deepEqual(calls[0].params, {
      TeamID: String(LAKERS_ID),
      Season: "2024-25",
      SeasonType: "Regular Season",
      DateFrom: "",
      DateTo: "",
      LeagueID: "00",
    });
    assert.deepEqual(result.TeamGameLog, games);
  });
});

describe("playerCareerStats", () => {
  it("requests a player's career totals and returns them by result set", async (t) => {
    const seasons = [{ PLAYER_ID: 2544, SEASON_ID: "2024-25", TEAM_ID: LAKERS_ID, GP: 70, PTS: 1708 }];
    const calls = stubStatsApi(t, {
      playercareerstats: resultSets({
        SeasonTotalsRegularSeason: seasons,
        CareerTotalsRegularSeason: [{ PLAYER_ID: 2544, GP: 1562 }],
      }),
    });

    const result = await playerCareerStats({ playerId: 2544 });

    assert.deepEqual(calls[0].params, { PerMode: "Totals", PlayerID: "2544", LeagueID: "" });
    assert.deepEqual(result.SeasonTotalsRegularSeason, seasons);
    assert.equal(result.CareerTotalsRegularSeason[0].GP, 1562);
  });
});
