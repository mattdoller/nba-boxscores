import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, describe, it } from "node:test";
import {
  LIVE_TTL_MS,
  app,
  careerSeasons,
  clockSeconds,
  findShotAction,
  gameClock,
  isoDate,
  offlineReason,
  withPossession,
  withRunningScore,
} from "../server.js";
import { markFixtures } from "../nba-api/cache.js";
import { indexGame } from "../season-index.js";
import { setOffline } from "../nba-api/http.js";
import { teamGameLog } from "../nba-api/index.js";
import { teamColors } from "../team-colors.js";
import {
  CELTICS_ID,
  LAKERS_ID,
  action,
  boxScoreSummaryJson,
  boxScoreTraditionalJson,
  playByPlayJson,
} from "./fixtures.js";
import { resultSets, stubStatsApi } from "./helpers.js";

describe("isoDate", () => {
  it("converts a game log date", () => {
    assert.equal(isoDate("APR 13, 2025"), "2025-04-13");
    assert.equal(isoDate("NOV 2, 2024"), "2024-11-02");
  });
});

describe("gameClock", () => {
  it("formats a play-by-play clock", () => {
    assert.equal(gameClock("PT11M42.00S"), "11:42");
    assert.equal(gameClock("PT00M05.70S"), "0:05");
  });

  it("is empty for a missing or malformed clock", () => {
    assert.equal(gameClock(null), "");
    assert.equal(gameClock("11:42"), "");
  });
});

describe("clockSeconds", () => {
  it("counts the seconds left in the period", () => {
    assert.equal(clockSeconds("PT11M42.50S"), 702);
  });

  it("is null for a missing clock", () => {
    assert.equal(clockSeconds(undefined), null);
  });
});

describe("withRunningScore", () => {
  it("carries the score through plays without one", () => {
    const plays = [
      { scoreHome: "", scoreAway: "" },
      { scoreHome: "2", scoreAway: "0" },
      { scoreHome: null, scoreAway: null },
      { scoreHome: "0", scoreAway: "0" },
      { scoreHome: "2", scoreAway: "3" },
      { scoreHome: "2", scoreAway: "3" },
    ];

    const result = withRunningScore(plays);

    assert.deepEqual(result.map((r) => r.score), [
      { home: 0, away: 0 },
      { home: 2, away: 0 },
      { home: 2, away: 0 },
      { home: 2, away: 0 },
      { home: 2, away: 3 },
      { home: 2, away: 3 },
    ]);
    assert.deepEqual(result.map((r) => r.scored), [false, true, false, false, true, false]);
    assert.deepEqual(result.map((r) => r.points), [0, 2, 0, 0, 3, 0]);
    assert.equal(result[1].action, plays[1]);
  });
});

describe("withPossession", () => {
  const play = (actionType, teamTricode, fields = {}) => action({ actionType, teamTricode, ...fields });

  it("follows the ball through the plays that change it", () => {
    const plays = [
      play("period", "", { subType: "start" }),
      play("Jump Ball", "BOS", { description: "Jump Ball Queta vs. Looney: Tip to Fears" }),
      play("Missed Shot", "NOP", { playerName: "Fears" }),
      play("Rebound", "BOS"),
      play("Made Shot", "BOS"),
      play("Turnover", "NOP"),
      play("Missed Shot", "BOS"),
      play("Rebound", "BOS"),
      play("Foul", "NOP", { subType: "Personal" }),
      play("Free Throw", "BOS", { subType: "Free Throw 1 of 2", description: "MISS Brown Free Throw 1 of 2" }),
      play("Free Throw", "BOS", { subType: "Free Throw 2 of 2", description: "Brown Free Throw 2 of 2 (1 PTS)" }),
      play("period", "", { subType: "end" }),
    ];

    assert.deepEqual(withPossession(plays), [
      null,
      "NOP", // tipped to Fears, a Pelican
      "NOP",
      "BOS", // defensive rebound
      "NOP", // made shot
      "BOS", // turnover
      "BOS",
      "BOS", // offensive rebound
      "BOS", // fouls don't change it
      "BOS", // first free throw
      "NOP", // last free throw made
      null, // between periods
    ]);
  });

  it("keeps the ball with the shooter's team on an and-one until the free throw", () => {
    const plays = [
      play("Made Shot", "BOS"),
      play("Substitution", "NOP"),
      play("Foul", "NOP", { subType: "Shooting" }),
      play("Free Throw", "BOS", { subType: "Free Throw 1 of 1", description: "Brown Free Throw 1 of 1 (3 PTS)" }),
    ];

    assert.deepEqual(withPossession(plays), ["BOS", "BOS", "BOS", "NOP"]);
  });

  it("leaves a missed last free throw to the rebound", () => {
    const plays = [
      play("Free Throw", "BOS", { subType: "Free Throw 1 of 1", description: "MISS Brown Free Throw 1 of 1" }),
      play("Rebound", "NOP"),
    ];

    assert.deepEqual(withPossession(plays), ["BOS", "NOP"]);
  });

  it("doesn't change possession on technical free throws", () => {
    const plays = [
      play("Missed Shot", "BOS"),
      play("Rebound", "BOS"),
      play("Free Throw", "NOP", { subType: "Free Throw Technical", description: "Poole Free Throw Technical (5 PTS)" }),
    ];

    assert.deepEqual(withPossession(plays), ["BOS", "BOS", "BOS"]);
  });

  it("gives the ball back after flagrant and clear-path free throws", () => {
    const plays = [
      play("Free Throw", "BOS", { subType: "Free Throw Flagrant 2 of 2", description: "Brown Free Throw Flagrant 2 of 2 (2 PTS)" }),
      play("Turnover", "BOS"),
      play("Free Throw", "NOP", { subType: "Free Throw Clear Path", description: "Poole Free Throw Clear Path (1 PTS)" }),
    ];

    assert.deepEqual(withPossession(plays), ["BOS", "NOP", "NOP"]);
  });
});

describe("findShotAction", () => {
  const shot = { PLAYER_ID: 2544, PERIOD: 2, GAME_EVENT_ID: 50, MINUTES_REMAINING: 3, SECONDS_REMAINING: 15 };
  const fieldGoal = { isFieldGoal: 1, personId: 2544, period: 2 };

  it("matches the action number first", () => {
    const match = { ...fieldGoal, actionNumber: 50, actionId: 1, clock: "PT01M00.00S" };
    const actions = [{ ...fieldGoal, actionNumber: 1, actionId: 50, clock: "PT03M15.00S" }, match];

    assert.equal(findShotAction(shot, actions), match);
  });

  it("falls back to the action id, then the clock", () => {
    const byId = { ...fieldGoal, actionNumber: 1, actionId: 50 };
    const byClock = { ...fieldGoal, actionNumber: 2, actionId: 2, clock: "PT03M15.40S" };

    assert.equal(findShotAction(shot, [byId]), byId);
    assert.equal(findShotAction(shot, [byClock]), byClock);
  });

  it("ignores non-field goals and other players or periods", () => {
    const actions = [
      { ...fieldGoal, actionNumber: 50, isFieldGoal: 0 },
      { ...fieldGoal, actionNumber: 50, personId: 1 },
      { ...fieldGoal, actionNumber: 50, period: 3 },
    ];

    assert.equal(findShotAction(shot, actions), undefined);
  });
});

describe("careerSeasons", () => {
  const row = (season, teamId, team, gp, pts) => ({
    SEASON_ID: season, TEAM_ID: teamId, TEAM_ABBREVIATION: team, PLAYER_AGE: 30, GP: gp, PTS: pts,
  });

  it("gives each season one row, oldest first", () => {
    const seasons = careerSeasons([row("2024-25", 1, "LAL", 70, 1708), row("2023-24", 1, "LAL", 71, 1822)]);

    assert.deepEqual(seasons.map((s) => [s.season, s.team, s.gp]), [[2023, "LAL", 71], [2024, "LAL", 70]]);
  });

  it("combines a season split across teams, from its total row", () => {
    const [season] = careerSeasons([
      row("2022-23", 1, "BKN", 39, 1166),
      row("2022-23", 2, "PHX", 8, 210),
      row("2022-23", 0, "TOT", 47, 1376),
    ]);

    assert.equal(season.team, "BKN/PHX");
    assert.equal(season.gp, 47);
    assert.equal(season.pts, 1376);
  });
});

// Before the API tests, one of which marks the cache as holding fixtures.
describe("offlineReason", () => {
  it("is null normally, so the server asks stats.nba.com", () => {
    assert.equal(offlineReason(), null);
  });

  it("explains itself when NBA_OFFLINE is set", (t) => {
    process.env.NBA_OFFLINE = "1";
    t.after(() => delete process.env.NBA_OFFLINE);

    assert.match(offlineReason(), /offline/);
  });
});

describe("API", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = app.listen(0);
    await once(server, "listening");
    baseUrl = `http://localhost:${server.address().port}`;
  });

  after(() => {
    server.close();
  });

  async function get(path) {
    const res = await fetch(`${baseUrl}${path}`);
    return { status: res.status, body: await res.json() };
  }

  describe("GET /api/info", () => {
    it("says whether the cache holds bin/load-fixtures' fake games", async () => {
      assert.deepEqual((await get("/api/info")).body, { fixtures: false, offline: false, seasons: null });

      markFixtures();

      assert.deepEqual((await get("/api/info")).body, { fixtures: true, offline: true, seasons: [] });
    });

    it("lists the seasons with games when offline", async (t) => {
      markFixtures();
      const games = [{ Team_ID: CELTICS_ID, Game_ID: "0022309001", GAME_DATE: "OCT 21, 2023", MATCHUP: "BOS vs. LAL", WL: "W" }];
      const empty = { resultSets: [{ name: "TeamGameLog", headers: [], rowSet: [] }] };
      stubStatsApi(t, {
        teamgamelog: (params) => {
          if (params.get("Season") === "2023-24" && params.get("SeasonType") === "Regular Season") {
            return resultSets({ TeamGameLog: games });
          }
          return empty;
        },
      });
      // Cache a season with games and one without.
      await teamGameLog({ teamId: CELTICS_ID, season: 2023 });
      await teamGameLog({ teamId: CELTICS_ID, season: 2019 });

      assert.deepEqual((await get("/api/info")).body.seasons, [2023]);
    });

    it("keeps a test data server from asking stats.nba.com", async (t) => {
      markFixtures();
      const calls = stubStatsApi(t, {});
      setOffline(offlineReason());
      t.after(() => setOffline(null));

      const { status, body } = await get("/api/boxscore?game_id=0022400999");

      assert.equal(status, 404);
      assert.match(body.error, /^Not in the test data/);
      assert.equal(calls.length, 0);
    });
  });

  describe("GET /api/teams", () => {
    it("lists every team with its colors", async () => {
      const { status, body } = await get("/api/teams");

      assert.equal(status, 200);
      assert.equal(body.length, 30);
      const lakers = body.find((t) => t.id === LAKERS_ID);
      assert.equal(lakers.full_name, "Los Angeles Lakers");
      assert.deepEqual(lakers.colors, teamColors(LAKERS_ID));
    });
  });

  describe("GET /api/games", () => {
    it("merges regular season, play-in, and playoff games by date", async (t) => {
      const logs = {
        "Regular Season": [
          { Game_ID: "0022300050", GAME_DATE: "NOV 01, 2023", MATCHUP: "LAL vs. BOS", WL: "L" },
          { Game_ID: "0022300001", GAME_DATE: "OCT 24, 2023", MATCHUP: "LAL @ DEN", WL: "W" },
        ],
        PlayIn: [{ Game_ID: "0052300101", GAME_DATE: "APR 16, 2024", MATCHUP: "LAL vs. NOP", WL: "W" }],
        Playoffs: [],
      };
      const calls = stubStatsApi(t, {
        teamgamelog: (params) => resultSets({ TeamGameLog: logs[params.get("SeasonType")] }),
      });

      const { status, body } = await get(`/api/games?team_id=${LAKERS_ID}&season=2023`);

      assert.equal(status, 200);
      assert.deepEqual(calls.map((c) => c.params.SeasonType).sort(), ["PlayIn", "Playoffs", "Regular Season"]);
      assert.ok(calls.every((c) => c.params.Season === "2023-24"));
      assert.deepEqual(body, [
        { id: "0022300001", date: "2023-10-24", matchup: "LAL @ DEN", result: "W", postseason: false },
        { id: "0022300050", date: "2023-11-01", matchup: "LAL vs. BOS", result: "L", postseason: false },
        { id: "0052300101", date: "2024-04-16", matchup: "LAL vs. NOP", result: "W", postseason: true },
      ]);
    });

    it("rejects a missing or unknown team", async (t) => {
      const calls = stubStatsApi(t, {});

      for (const query of ["season=2023", "team_id=&season=2023", "team_id=1&season=2023", "team_id=LAL&season=2023"]) {
        const { status, body } = await get(`/api/games?${query}`);

        assert.equal(status, 400, query);
        assert.match(body.error, /team_id/);
      }
      assert.equal(calls.length, 0);
    });

    it("rejects a missing or out-of-range season", async (t) => {
      t.mock.timers.enable({ apis: ["Date"], now: new Date(2025, 10, 1) });
      const calls = stubStatsApi(t, {});

      for (const season of ["", "abc", "23", "2023-24", "1945", "2026"]) {
        const { status, body } = await get(`/api/games?team_id=${LAKERS_ID}&season=${season}`);

        assert.equal(status, 400, season);
        assert.equal(body.error, "season must be a year from 1946 to 2025.");
      }
      assert.equal(calls.length, 0);
    });

    it("accepts the first and current seasons", async (t) => {
      t.mock.timers.enable({ apis: ["Date"], now: new Date(2025, 10, 1) });
      stubStatsApi(t, { teamgamelog: { resultSets: [] } });

      for (const season of ["1946", "2025"]) {
        const { status } = await get(`/api/games?team_id=${LAKERS_ID}&season=${season}`);

        assert.equal(status, 200, season);
      }
    });

    it("tolerates seasons with no game log", async (t) => {
      stubStatsApi(t, { teamgamelog: { resultSets: [] } });

      const { status, body } = await get(`/api/games?team_id=${LAKERS_ID}&season=2015`);

      assert.equal(status, 200);
      assert.deepEqual(body, []);
    });
  });

  describe("GET /api/boxscore", () => {
    it("rejects a malformed game id", async () => {
      for (const query of ["", "?game_id=123", "?game_id=00224000011", "?game_id=abcdefghij"]) {
        const { status, body } = await get(`/api/boxscore${query}`);

        assert.equal(status, 400, query);
        assert.match(body.error, /10-digit/);
      }
    });

    it("returns the line score and player stats", async (t) => {
      stubStatsApi(t, {
        boxscoretraditionalv3: boxScoreTraditionalJson("0022400101"),
        boxscoresummaryv3: boxScoreSummaryJson("0022400101"),
      });

      const { status, body } = await get("/api/boxscore?game_id=0022400101");

      assert.equal(status, 200);
      assert.deepEqual(body.game, {
        id: "0022400101",
        date: "2024-10-22",
        status: "Final/OT",
        postseason: false,
        venue: { name: "Crypto.com Arena", city: "Los Angeles", state: "CA", country: "US" },
        attendance: 18997,
        sellout: true,
        home: {
          id: LAKERS_ID,
          abbreviation: "LAL",
          full_name: "Los Angeles Lakers",
          score: 112,
          colors: teamColors(LAKERS_ID),
          periods: [
            { label: "Q1", score: 30 },
            { label: "Q2", score: 25 },
            { label: "Q3", score: 27 },
            { label: "Q4", score: 20 },
            { label: "OT1", score: 10 },
          ],
        },
        away: {
          id: CELTICS_ID,
          abbreviation: "BOS",
          full_name: "Boston Celtics",
          score: 108,
          colors: teamColors(CELTICS_ID),
          periods: [
            { label: "Q1", score: 28 },
            { label: "Q2", score: 26 },
            { label: "Q3", score: 24 },
            { label: "Q4", score: 24 },
            { label: "OT1", score: 6 },
          ],
        },
      });
      assert.equal(body.stats.length, 3);
      assert.deepEqual(body.stats[0], {
        team_id: LAKERS_ID,
        player_id: 2544,
        recorded: true,
        first_name: "LeBron",
        last_name: "James",
        position: "F",
        comment: "",
        min: "36:12",
        pts: 30,
        reb: 8,
        ast: 10,
        stl: 7,
        blk: 5,
        turnover: 12,
        pf: 19,
        fgm: 40,
        fga: 85,
        fg3m: 12,
        fg3a: 33,
        ftm: 18,
        fta: 22,
        plus_minus: 6,
      });
    });

    it("marks players without stats as not recorded", async (t) => {
      stubStatsApi(t, {
        boxscoretraditionalv3: boxScoreTraditionalJson("0022400102"),
        boxscoresummaryv3: boxScoreSummaryJson("0022400102"),
      });

      const { body } = await get("/api/boxscore?game_id=0022400102");
      const dnp = body.stats.find((p) => p.last_name === "Warmer");

      assert.equal(dnp.recorded, false);
      assert.equal(dnp.comment, "DNP - Coach's Decision");
    });

    it("falls back to team totals when the summary fails", async (t) => {
      stubStatsApi(t, {
        boxscoretraditionalv3: boxScoreTraditionalJson("0042400103"),
        boxscoresummaryv3: new Response("", { status: 500 }),
      });

      const { status, body } = await get("/api/boxscore?game_id=0042400103&date=2025-05-01");

      assert.equal(status, 200);
      assert.equal(body.game.status, "Final");
      assert.equal(body.game.date, "2025-05-01");
      assert.equal(body.game.postseason, true);
      assert.equal(body.game.home.score, 112);
      assert.deepEqual(body.game.home.periods, []);
      assert.equal(body.game.venue, null);
      assert.equal(body.game.attendance, null);
    });

    it("returns 404 when the game has no player stats", async (t) => {
      stubStatsApi(t, {
        boxscoretraditionalv3: boxScoreTraditionalJson("0022400104", { players: false }),
        boxscoresummaryv3: boxScoreSummaryJson("0022400104"),
      });

      const { status, body } = await get("/api/boxscore?game_id=0022400104");

      assert.equal(status, 404);
      assert.match(body.error, /no box score/);
    });

    it("passes along stats.nba.com errors", async (t) => {
      t.mock.method(console, "error", () => {});
      stubStatsApi(t, {
        boxscoretraditionalv3: new Response("", { status: 503 }),
        boxscoresummaryv3: boxScoreSummaryJson("0022400105"),
      });

      const { status, body } = await get("/api/boxscore?game_id=0022400105");

      assert.equal(status, 503);
      assert.match(body.error, /returned 503/);
    });
  });

  describe("caching", () => {
    function liveSummary(gameId) {
      const json = boxScoreSummaryJson(gameId);
      json.boxScoreSummary.gameStatus = 2;
      return json;
    }

    it("refetches a game in progress once its responses are a minute old", async (t) => {
      t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
      const calls = stubStatsApi(t, {
        boxscoresummaryv3: liveSummary("0022400901"),
        playbyplayv3: playByPlayJson("0022400901", []),
      });

      await get("/api/playbyplay?game_id=0022400901");
      await get("/api/playbyplay?game_id=0022400901");
      t.mock.timers.tick(LIVE_TTL_MS);
      await get("/api/playbyplay?game_id=0022400901");

      assert.deepEqual(calls.map((c) => c.endpoint), [
        "boxscoresummaryv3",
        "playbyplayv3",
        "boxscoresummaryv3",
        "playbyplayv3",
      ]);
    });

    it("keeps a final game's responses for good", async (t) => {
      t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
      const calls = stubStatsApi(t, {
        boxscoresummaryv3: boxScoreSummaryJson("0022400902"),
        boxscoretraditionalv3: boxScoreTraditionalJson("0022400902"),
      });

      await get("/api/boxscore?game_id=0022400902");
      t.mock.timers.tick(365 * 24 * 60 * 60_000);
      await get("/api/boxscore?game_id=0022400902");

      assert.deepEqual(calls.map((c) => c.endpoint), ["boxscoresummaryv3", "boxscoretraditionalv3"]);
    });
  });

  describe("GET /api/playbyplay", () => {
    it("rejects a malformed game id", async () => {
      const { status } = await get("/api/playbyplay?game_id=nope");

      assert.equal(status, 400);
    });

    it("returns each play with the running score", async (t) => {
      stubStatsApi(t, {
        playbyplayv3: playByPlayJson("0022400201", [
          action({ actionNumber: 2, clock: "PT12M00.00S", description: "Jump Ball" }),
          action({
            actionNumber: 7,
            clock: "PT11M30.00S",
            teamTricode: "LAL",
            personId: 2544,
            playerNameI: "L. James",
            description: "James 2' Layup (2 PTS)",
            scoreHome: "2",
            scoreAway: "0",
          }),
          action({ actionNumber: 900, period: 5, clock: "PT00M00.00S", description: "End of 1st OT" }),
        ]),
      });

      const { status, body } = await get("/api/playbyplay?game_id=0022400201");

      assert.equal(status, 200);
      assert.deepEqual(body, [
        {
          id: 2,
          period: 1,
          period_label: "Q1",
          clock: "12:00",
          team: null,
          player: null,
          player_id: null,
          description: "Jump Ball",
          scored: false,
          points: 0,
          score: { home: 0, away: 0 },
          possession: null,
        },
        {
          id: 7,
          period: 1,
          period_label: "Q1",
          clock: "11:30",
          team: "LAL",
          player: "L. James",
          player_id: 2544,
          description: "James 2' Layup (2 PTS)",
          scored: true,
          points: 2,
          score: { home: 2, away: 0 },
          possession: null,
        },
        {
          id: 900,
          period: 5,
          period_label: "OT1",
          clock: "0:00",
          team: null,
          player: null,
          player_id: null,
          description: "End of 1st OT",
          scored: false,
          points: 0,
          score: { home: 2, away: 0 },
          possession: null,
        },
      ]);
    });
  });

  describe("GET /api/player", () => {
    it("rejects a malformed player id", async () => {
      assert.equal((await get("/api/player?player_id=lebron")).status, 400);
    });

    it("returns the player's seasons and career totals", async (t) => {
      const season = {
        PLAYER_ID: 777, SEASON_ID: "2023-24", LEAGUE_ID: "00", TEAM_ID: LAKERS_ID, TEAM_ABBREVIATION: "LAL",
        PLAYER_AGE: 39, GP: 71, GS: 71, MIN: 2504, FGM: 685, FGA: 1269, FG3M: 149, FG3A: 361, FTM: 324,
        FTA: 432, OREB: 85, DREB: 433, REB: 518, AST: 589, STL: 89, BLK: 38, TOV: 245, PF: 78, PTS: 1822,
      };
      const calls = stubStatsApi(t, {
        playercareerstats: resultSets({
          SeasonTotalsRegularSeason: [season],
          CareerTotalsRegularSeason: [{ ...season, SEASON_ID: undefined }],
        }),
      });

      const { status, body } = await get("/api/player?player_id=777");

      assert.equal(status, 200);
      assert.equal(calls[0].params.PlayerID, "777");
      assert.equal(body.id, 777);
      assert.deepEqual(body.seasons[0], {
        season: 2023, team: "LAL", age: 39, gp: 71, gs: 71, min: 2504, pts: 1822, reb: 518, oreb: 85,
        dreb: 433, ast: 589, stl: 89, blk: 38, tov: 245, pf: 78, fgm: 685, fga: 1269, fg3m: 149, fg3a: 361,
        ftm: 324, fta: 432,
      });
      assert.equal(body.career.pts, 1822);
    });

    it("returns 404 for a player with no regular-season stats", async (t) => {
      stubStatsApi(t, { playercareerstats: { resultSets: [] } });

      assert.equal((await get("/api/player?player_id=778")).status, 404);
    });
  });

  describe("GET /api/playerzones", () => {
    it("rejects a season before shot data starts", async () => {
      assert.equal((await get("/api/playerzones?player_id=777&season=1990")).status, 400);
    });

    it("adds up the player's shots and the league's by zone", async (t) => {
      const shot = (basic, area, made) => ({ SHOT_ZONE_BASIC: basic, SHOT_ZONE_AREA: area, SHOT_MADE_FLAG: made });
      const calls = stubStatsApi(t, {
        shotchartdetail: resultSets({
          Shot_Chart_Detail: [
            shot("Restricted Area", "Center(C)", 1),
            shot("Restricted Area", "Center(C)", 0),
            shot("Left Corner 3", "Left Side(L)", 1),
          ],
          LeagueAverages: [
            { SHOT_ZONE_BASIC: "Restricted Area", SHOT_ZONE_AREA: "Center(C)", SHOT_ZONE_RANGE: "Less Than 8 ft.", FGA: 900, FGM: 600 },
          ],
        }),
      });

      const { status, body } = await get("/api/playerzones?player_id=777&season=2023");

      assert.equal(status, 200);
      const params = calls[0].params;
      assert.deepEqual([params.PlayerID, params.Season, params.SeasonType, params.ContextMeasure, params.GameID],
        ["777", "2023-24", "Regular Season", "FGA", ""]);
      assert.deepEqual(body, {
        season: 2023,
        zones: {
          "Restricted Area|Center(C)": { fgm: 1, fga: 2 },
          "Left Corner 3|Left Side(L)": { fgm: 1, fga: 1 },
        },
        league: { "Restricted Area|Center(C)": { fgm: 600, fga: 900 } },
      });
    });
  });

  describe("GET /api/team", () => {
    it("rejects an unknown team or a season before team stats start", async () => {
      assert.equal((await get("/api/team?team_id=1&season=2014")).status, 400);
      assert.equal((await get(`/api/team?team_id=${CELTICS_ID}&season=1990`)).status, 400);
    });

    it("lists the team's games and every team's season totals", async (t) => {
      const game = (teamId, abbr, id, date, matchup, wl, pts, plusMinus) => ({
        TEAM_ID: teamId, TEAM_ABBREVIATION: abbr, GAME_ID: id, GAME_DATE: date, MATCHUP: matchup, WL: wl, PTS: pts, PLUS_MINUS: plusMinus,
      });
      const calls = stubStatsApi(t, {
        leaguegamelog: resultSets({
          LeagueGameLog: [
            game(CELTICS_ID, "BOS", "0021400001", "2014-10-29", "BOS vs. LAL", "W", 110, 8),
            game(LAKERS_ID, "LAL", "0021400001", "2014-10-29", "LAL @ BOS", "L", 102, -8),
            game(CELTICS_ID, "BOS", "0021400009", "2014-11-01", "BOS @ LAL", "L", 95, -5),
            game(LAKERS_ID, "LAL", "0021400009", "2014-11-01", "LAL vs. BOS", "W", 100, 5),
          ],
        }),
        leaguedashteamstats: resultSets({
          LeagueDashTeamStats: [
            { TEAM_ID: CELTICS_ID, GP: 2, PTS: 205, FGM: 80, FGA: 170, AST: 50 },
            { TEAM_ID: LAKERS_ID, GP: 2, PTS: 202, FGM: 78, FGA: 175, AST: 41 },
          ],
        }),
      });

      const { status, body } = await get(`/api/team?team_id=${CELTICS_ID}&season=2014`);

      assert.equal(status, 200);
      const log = calls.find((c) => c.endpoint === "leaguegamelog").params;
      assert.deepEqual([log.Season, log.SeasonType, log.PlayerOrTeam], ["2014-15", "Regular Season", "T"]);
      assert.deepEqual(body.team, { id: CELTICS_ID, abbreviation: "BOS", full_name: "Boston Celtics" });
      assert.deepEqual(body.games, [
        { id: "0021400001", date: "2014-10-29", home: true, opponent: "LAL", result: "W", pts: 110, opp_pts: 102 },
        { id: "0021400009", date: "2014-11-01", home: false, opponent: "LAL", result: "L", pts: 95, opp_pts: 100 },
      ]);
      const celtics = body.teams.find((row) => row.team_id === CELTICS_ID);
      assert.deepEqual([celtics.gp, celtics.w, celtics.l, celtics.pts, celtics.opp_pts, celtics.ast], [2, 1, 1, 205, 202, 50]);
      assert.equal(body.teams.length, 2);
    });
  });

  describe("GET /api/players", () => {
    it("lists everyone who has played, by name, with their team now", async (t) => {
      const player = (id, name, status, from, to, team, played = "Y") => ({
        PERSON_ID: id, DISPLAY_FIRST_LAST: name, ROSTERSTATUS: status, FROM_YEAR: from, TO_YEAR: to, TEAM_ABBREVIATION: team, GAMES_PLAYED_FLAG: played,
      });
      const calls = stubStatsApi(t, {
        commonallplayers: resultSets({
          CommonAllPlayers: [
            player(893, "Michael Jordan", 0, "1984", "2002", ""),
            player(2544, "LeBron James", 1, "2003", "2026", "LAL"),
            player(9, "Never Played", 1, "2026", "2026", "BOS", "N"),
          ],
        }),
      });

      const { status, body } = await get("/api/players");

      assert.equal(status, 200);
      assert.equal(calls[0].params.IsOnlyCurrentSeason, "0");
      assert.deepEqual(body, [
        { id: 2544, name: "LeBron James", from: 2003, to: 2026, team: "LAL" },
        { id: 893, name: "Michael Jordan", from: 1984, to: 2002, team: null },
      ]);
    });
  });

  describe("GET /api/playerseason", () => {
    const players = (pts) => [{ personId: 77, teamId: CELTICS_ID, minutes: "30:00", points: pts, position: "G", fieldGoalsMade: 4, fieldGoalsAttempted: 9, plusMinusPoints: 5 }];
    const teams = (home, away) => [
      { teamId: CELTICS_ID, homeTeamId: CELTICS_ID, awayTeamId: LAKERS_ID, points: home },
      { teamId: LAKERS_ID, homeTeamId: CELTICS_ID, awayTeamId: LAKERS_ID, points: away },
    ];

    before(() => {
      indexGame({ gameId: "0029800001", season: 1998, date: "1999-02-05", players: players(20), teams: teams(101, 99), shots: [
        { player_id: 77, team_id: CELTICS_ID, zone: "Restricted Area|Center(C)", made: true },
      ] });
      indexGame({ gameId: "0029800002", season: 1998, date: "1999-02-07", players: players(30), teams: teams(90, 104), shots: [] });
    });

    it("rejects a bad date", async () => {
      assert.equal((await get("/api/playerseason?player_id=77&season=1998&through=yesterday")).status, 400);
    });

    it("lists the player's games through a date, with totals and zones", async () => {
      const { status, body } = await get("/api/playerseason?player_id=77&season=1998&through=1999-02-05");

      assert.equal(status, 200);
      assert.equal(body.league_games, 1);
      assert.deepEqual(body.games.map((g) => [g.date, g.opponent, g.home, g.result, g.team_pts, g.opp_pts, g.pts, g.min]),
        [["1999-02-05", "LAL", true, "W", 101, 99, 20, 30]]);
      assert.deepEqual([body.totals.gp, body.totals.gs, body.totals.pts, body.totals.fga], [1, 1, 20, 9]);
      assert.deepEqual(body.zones, { "Restricted Area|Center(C)": { fgm: 1, fga: 1 } });
    });

    it("covers the whole season without a date", async () => {
      const { body } = await get("/api/playerseason?player_id=77&season=1998");

      assert.deepEqual(body.games.map((g) => g.result), ["W", "L"]);
      assert.equal(body.totals.pts, 50);
    });
  });

  describe("GET /api/teamhistory", () => {
    it("rejects an unknown team", async () => {
      assert.equal((await get("/api/teamhistory?team_id=1")).status, 400);
    });

    it("lists every season, with its name, record, finish, and playoffs", async (t) => {
      const season = (year, city, name, w, l, conf, poW, poL, finals) => ({
        TEAM_ID: LAKERS_ID, TEAM_CITY: city, TEAM_NAME: name, YEAR: year, GP: w + l, WINS: w, LOSSES: l,
        CONF_RANK: conf, DIV_RANK: 1, PO_WINS: poW, PO_LOSSES: poL, NBA_FINALS_APPEARANCE: finals,
      });
      const calls = stubStatsApi(t, {
        teamyearbyyearstats: resultSets({
          TeamStats: [
            season("1959-60", "Minneapolis", "Lakers", 25, 50, 0, 5, 4, "N/A"),
            season("2019-20", "Los Angeles", "Lakers", 52, 19, 1, 16, 5, "LEAGUE CHAMPION"),
            season("2021-22", "Los Angeles", "Lakers", 33, 49, 11, 0, 0, "N/A"),
          ],
        }),
      });

      const { status, body } = await get(`/api/teamhistory?team_id=${LAKERS_ID}`);

      assert.equal(status, 200);
      assert.equal(calls[0].params.TeamID, String(LAKERS_ID));
      assert.deepEqual(body.seasons.map((s) => [s.season, s.name, s.w, s.l, s.conf_rank, s.po_w, s.finals]), [
        [1959, "Minneapolis Lakers", 25, 50, null, 5, null],
        [2019, "Los Angeles Lakers", 52, 19, 1, 16, "champion"],
        [2021, "Los Angeles Lakers", 33, 49, 11, 0, null],
      ]);
    });
  });

  describe("GET /api/teamzones", () => {
    it("adds up the team's season of shots and the league's by zone", async (t) => {
      const calls = stubStatsApi(t, {
        shotchartdetail: resultSets({
          Shot_Chart_Detail: [{ SHOT_ZONE_BASIC: "Restricted Area", SHOT_ZONE_AREA: "Center(C)", SHOT_MADE_FLAG: 1 }],
          LeagueAverages: [
            { SHOT_ZONE_BASIC: "Restricted Area", SHOT_ZONE_AREA: "Center(C)", SHOT_ZONE_RANGE: "Less Than 8 ft.", FGA: 900, FGM: 600 },
          ],
        }),
      });

      const { status, body } = await get(`/api/teamzones?team_id=${CELTICS_ID}&season=2013`);

      assert.equal(status, 200);
      const params = calls[0].params;
      assert.deepEqual([params.TeamID, params.PlayerID, params.Season, params.GameID], [String(CELTICS_ID), "0", "2013-14", ""]);
      assert.deepEqual(body.zones, { "Restricted Area|Center(C)": { fgm: 1, fga: 1 } });
      assert.deepEqual(body.league, { "Restricted Area|Center(C)": { fgm: 600, fga: 900 } });
    });
  });

  describe("GET /api/league", () => {
    it("rejects a season before team stats start, or none", async () => {
      assert.equal((await get("/api/league?seasons=2022,1990")).status, 400);
      assert.equal((await get("/api/league")).status, 400);
    });

    it("adds up the teams' totals, counting minutes per player", async (t) => {
      const team = (id, min, pts, fgm, fga) => ({ TEAM_ID: id, MIN: min, PTS: pts, FGM: fgm, FGA: fga, REB: 10 });
      const calls = stubStatsApi(t, {
        leaguedashteamstats: resultSets({ LeagueDashTeamStats: [team(1, 3940, 9000, 3300, 7000), team(2, 3950, 9500, 3500, 7100)] }),
      });

      const { status, body } = await get("/api/league?seasons=2022");

      assert.equal(status, 200);
      assert.equal(calls[0].params.Season, "2022-23");
      assert.equal(calls[0].params.PerMode, "Totals");
      const totals = body[2022];
      assert.equal(totals.teams, 2);
      assert.equal(totals.min, (3940 + 3950) * 5);
      assert.equal(totals.pts, 18500);
      assert.equal(totals.fga, 14100);
      assert.equal(totals.reb, 20);
      assert.equal(totals.ast, 0);
    });

    it("answers for several seasons at once, one request each", async (t) => {
      const calls = stubStatsApi(t, {
        leaguedashteamstats: resultSets({ LeagueDashTeamStats: [{ TEAM_ID: 1, MIN: 3940, PTS: 9000 }] }),
      });

      const { status, body } = await get("/api/league?seasons=2018,2019,2018");

      assert.equal(status, 200);
      assert.deepEqual(Object.keys(body), ["2018", "2019"]);
      assert.deepEqual(calls.map((call) => call.params.Season), ["2018-19", "2019-20"]);
      assert.equal(body[2019].pts, 9000);
    });

    it("gives null for a season that can't be loaded", async (t) => {
      t.mock.method(console, "error", () => {});
      stubStatsApi(t, {
        leaguedashteamstats: (params) => {
          if (params.get("Season") === "2016-17") {
            return new Response("Server error", { status: 500 });
          }
          return resultSets({ LeagueDashTeamStats: [{ TEAM_ID: 1, PTS: 9000 }] });
        },
      });

      const { status, body } = await get("/api/league?seasons=2016,2017");

      assert.equal(status, 200);
      assert.equal(body[2016], null);
      assert.equal(body[2017].pts, 9000);
    });
  });

  describe("GET /api/shotchart", () => {
    const shots = [
      {
        TEAM_ID: LAKERS_ID,
        PLAYER_ID: 2544,
        PLAYER_NAME: "LeBron James",
        GAME_EVENT_ID: 7,
        PERIOD: 1,
        MINUTES_REMAINING: 11,
        SECONDS_REMAINING: 30,
        ACTION_TYPE: "Driving Layup Shot",
        SHOT_TYPE: "2PT Field Goal",
        SHOT_DISTANCE: 2,
        LOC_X: 5,
        LOC_Y: 10,
        SHOT_MADE_FLAG: 1,
        SHOT_ZONE_BASIC: "Restricted Area",
        SHOT_ZONE_AREA: "Center(C)",
        SHOT_ZONE_RANGE: "Less Than 8 ft.",
      },
      {
        TEAM_ID: CELTICS_ID,
        PLAYER_ID: 1628369,
        PLAYER_NAME: "Jayson Tatum",
        GAME_EVENT_ID: 9,
        PERIOD: 1,
        MINUTES_REMAINING: 11,
        SECONDS_REMAINING: 5,
        ACTION_TYPE: "Jump Shot",
        SHOT_TYPE: "3PT Field Goal",
        SHOT_DISTANCE: 25,
        LOC_X: -220,
        LOC_Y: 90,
        SHOT_MADE_FLAG: 0,
      },
    ];
    const plays = [
      action({ actionNumber: 7, period: 1, clock: "PT11M30.00S", isFieldGoal: 1, personId: 2544, scoreHome: "2", scoreAway: "0" }),
      action({ actionNumber: 9, period: 1, clock: "PT11M05.00S", isFieldGoal: 1, personId: 1628369 }),
    ];

    it("rejects a malformed game id", async () => {
      const { status } = await get("/api/shotchart?game_id=1");

      assert.equal(status, 400);
    });

    it("groups every attempt by team, with its play and the score after makes", async (t) => {
      const calls = stubStatsApi(t, {
        shotchartdetail: resultSets({ Shot_Chart_Detail: shots }),
        playbyplayv3: playByPlayJson("0042300301", plays),
      });

      const { status, body } = await get("/api/shotchart?game_id=0042300301");

      assert.equal(status, 200);
      const chartCall = calls.find((c) => c.endpoint === "shotchartdetail");
      assert.equal(chartCall.params.Season, "2023-24");
      assert.equal(chartCall.params.SeasonType, "Playoffs");
      assert.equal(chartCall.params.ContextMeasure, "FGA");
      assert.deepEqual(Object.keys(body).sort(), [String(CELTICS_ID), String(LAKERS_ID)]);
      assert.deepEqual(body[LAKERS_ID], [{
        player: "LeBron James",
        player_id: 2544,
        period: 1,
        period_label: "Q1",
        clock: "11:30",
        action: "Driving Layup Shot",
        type: "2PT Field Goal",
        distance: 2,
        x: 5,
        y: 10,
        made: true,
        score: { home: 2, away: 0 },
        play_id: 7,
        zone: "Restricted Area|Center(C)",
      }]);
      assert.equal(body[CELTICS_ID][0].made, false);
      assert.equal(body[CELTICS_ID][0].play_id, 9);
      assert.equal(body[CELTICS_ID][0].clock, "11:05");
      assert.equal(body[CELTICS_ID][0].score, null);
    });

    it("leaves scores off when the play-by-play fails", async (t) => {
      stubStatsApi(t, {
        shotchartdetail: resultSets({ Shot_Chart_Detail: shots }),
        playbyplayv3: new Response("", { status: 500 }),
      });

      const { status, body } = await get("/api/shotchart?game_id=0022400302");

      assert.equal(status, 200);
      assert.equal(body[LAKERS_ID][0].made, true);
      assert.equal(body[LAKERS_ID][0].score, null);
      assert.equal(body[LAKERS_ID][0].play_id, null);
    });

    it("returns no teams when there are no shots", async (t) => {
      stubStatsApi(t, {
        shotchartdetail: { resultSets: [] },
        playbyplayv3: playByPlayJson("0022400303", []),
      });

      const { body } = await get("/api/shotchart?game_id=0022400303");

      assert.deepEqual(body, {});
    });
  });

  describe("GET /api/shotzones", () => {
    const league = (basic, area, range, fgm, fga) => ({
      GRID_TYPE: "League Averages",
      SHOT_ZONE_BASIC: basic,
      SHOT_ZONE_AREA: area,
      SHOT_ZONE_RANGE: range,
      FGA: fga,
      FGM: fgm,
      FG_PCT: fgm / fga,
    });

    it("rejects a malformed game id", async () => {
      const { status } = await get("/api/shotzones?game_id=x");

      assert.equal(status, 400);
    });

    it("adds up each zone's league averages across distances", async (t) => {
      const calls = stubStatsApi(t, {
        shotchartdetail: resultSets({
          Shot_Chart_Detail: [{ TEAM_ID: LAKERS_ID }],
          LeagueAverages: [
            league("Mid-Range", "Left Side(L)", "8-16 ft.", 40, 100),
            league("Mid-Range", "Left Side(L)", "16-24 ft.", 30, 80),
            league("Restricted Area", "Center(C)", "Less Than 8 ft.", 600, 900),
          ],
        }),
      });

      const { status, body } = await get("/api/shotzones?game_id=0022400304");

      assert.equal(status, 200);
      assert.deepEqual(body, {
        "Mid-Range|Left Side(L)": { fgm: 70, fga: 180 },
        "Restricted Area|Center(C)": { fgm: 600, fga: 900 },
      });
      assert.equal(calls.find((c) => c.endpoint === "shotchartdetail").params.Season, "2024-25");
    });
  });
});
