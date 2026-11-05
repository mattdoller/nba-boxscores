import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeSeason } from "../dev/fake-season.js";
import { gameLineups } from "../lineups.js";
import { parseBoxScoreTraditionalV3 } from "../nba-api/endpoints/boxscoretraditionalv3.js";

const HOME = 1;
const AWAY = 2;

// A box score row. Starters have a position, like stats.nba.com's.
function player(personId, teamId, familyName, { firstName = "A", starter = false, minutes = "10:00" } = {}) {
  return { personId, teamId, homeTeamId: HOME, awayTeamId: AWAY, firstName, familyName, position: starter ? "F" : "", minutes };
}

// Home players 1-7 and away players 11-15; 1-5 and 11-15 start.
const ROSTER = [
  ...["Able", "Baker", "Cole", "Dunn", "Ellis"].map((name, i) => player(i + 1, HOME, name, { starter: true, minutes: "30:00" })),
  player(6, HOME, "Fox"),
  player(7, HOME, "Grant"),
  ...["Hale", "Irwin", "Jones", "Kemp", "Lowe"].map((name, i) => player(i + 11, AWAY, name, { starter: true, minutes: "30:00" })),
];

let number = 0;
function action(period, clock, fields = {}) {
  number++;
  const [m, s] = clock.split(":");
  return { actionNumber: number, period, clock: `PT${m.padStart(2, "0")}M${s}.00S`, teamId: 0, personId: 0, scoreHome: "", scoreAway: "", description: "", actionType: "", ...fields };
}

function sub(period, clock, teamId, outId, inName) {
  const out = ROSTER.find((p) => p.personId === outId);
  return action(period, clock, { teamId, personId: outId, actionType: "Substitution", description: `SUB: ${inName} FOR ${out.familyName}` });
}

function made(period, clock, teamId, personId, home, away) {
  return action(period, clock, { teamId, personId, actionType: "Made Shot", scoreHome: String(home), scoreAway: String(away) });
}

const unitOf = (lineups, teamId, ids) => lineups[teamId].find((u) => [...u.players].sort().join() === [...ids].sort().join());

describe("gameLineups", () => {
  it("follows substitutions, crediting each unit its time and points", () => {
    const actions = [
      made(1, "11:00", HOME, 1, 2, 0),
      sub(1, "6:00", HOME, 5, "Fox"),
      made(1, "5:00", AWAY, 11, 2, 3),
    ];

    const lineups = gameLineups(actions, ROSTER);

    const starters = unitOf(lineups, HOME, [1, 2, 3, 4, 5]);
    const second = unitOf(lineups, HOME, [1, 2, 3, 4, 6]);
    assert.deepEqual([starters.seconds, starters.pts_for, starters.pts_against], [360, 2, 0]);
    assert.deepEqual([second.seconds, second.pts_for, second.pts_against], [360, 0, 3]);
    assert.deepEqual(lineups[AWAY].map((u) => [u.seconds, u.pts_for, u.pts_against]), [[720, 3, 2]]);
    assert.equal(lineups.unmatched, 0);
  });

  it("works out who opened a quarter from who shows up in it", () => {
    const actions = [
      sub(1, "6:00", HOME, 5, "Fox"),
      // The second quarter opens with Grant in for Dunn, unrecorded.
      made(2, "11:00", HOME, 7, 2, 0),
      made(2, "10:00", HOME, 1, 4, 0),
      sub(2, "9:00", HOME, 2, "Ellis"),
      made(2, "8:00", HOME, 3, 6, 0),
      made(2, "7:00", HOME, 6, 8, 0),
    ];

    const lineups = gameLineups(actions, ROSTER);

    // Everyone in the quarter's plays before a substitution sent them in:
    // Grant, Able, Baker (subbed out), Cole, and Fox. Dunn, who isn't in
    // any, sat.
    const opening = unitOf(lineups, HOME, [7, 1, 2, 3, 6]);
    assert.equal(opening.seconds, 180);
    assert.equal(unitOf(lineups, HOME, [7, 1, 5, 3, 6]).seconds, 540);
  });

  it("credits free throws to the five on the floor for the foul", () => {
    const actions = [
      action(1, "6:00", { teamId: AWAY, personId: 11, actionType: "Foul" }),
      action(1, "6:00", { teamId: HOME, personId: 1, actionType: "Free Throw", scoreHome: "1", scoreAway: "0" }),
      sub(1, "6:00", HOME, 5, "Fox"),
      action(1, "6:00", { teamId: HOME, personId: 1, actionType: "Free Throw", scoreHome: "2", scoreAway: "0" }),
    ];

    const lineups = gameLineups(actions, ROSTER);

    assert.equal(unitOf(lineups, HOME, [1, 2, 3, 4, 5]).pts_for, 2);
    assert.equal(unitOf(lineups, HOME, [1, 2, 3, 4, 6]).pts_for, 0);
  });

  it("matches the names substitutions use to the box score's", () => {
    const roster = [
      ...ROSTER.filter((p) => p.teamId === AWAY || p.position),
      player(6, HOME, "Vučević"),
      player(7, HOME, "Butler III"),
      player(8, HOME, "Williams", { firstName: "Jalen" }),
      player(9, HOME, "Williams", { firstName: "Jaylin" }),
      player(10, HOME, "Yang", { firstName: "Hansen" }),
    ];
    const swap = (clock, outId, name) => action(1, clock, {
      teamId: HOME, personId: outId, actionType: "Substitution",
      description: `SUB: ${name} FOR ${roster.find((p) => p.personId === outId).familyName}`,
    });
    const actions = [
      swap("10:00", 5, "Vucevic"),
      swap("9:00", 4, "Butler"),
      swap("8:00", 3, "Jay. Williams"),
      swap("7:00", 2, "Hansen"),
    ];

    const lineups = gameLineups(actions, roster);

    assert.equal(lineups.unmatched, 0);
    assert.ok(unitOf(lineups, HOME, [1, 10, 9, 7, 6]), "every substitution found its player");
  });

  it("counts a substitution it can't place", () => {
    const lineups = gameLineups([sub(1, "6:00", HOME, 5, "Nobody")], ROSTER);

    assert.equal(lineups.unmatched, 1);
    assert.equal(unitOf(lineups, HOME, [1, 2, 3, 4, 5]).seconds, 720);
  });

  it("adds up to every fake game's box score", () => {
    const season = fakeSeason({ season: 2025, gamesPerTeam: 2, seed: 4 });
    for (const game of season.byGame.values()) {
      const { PlayerStats } = parseBoxScoreTraditionalV3(game.boxscoretraditionalv3);
      const lineups = gameLineups(game.playbyplayv3.game.actions, PlayerStats);
      assert.equal(lineups.unmatched, 0);
      for (const p of PlayerStats.filter((row) => row.minutes)) {
        const units = lineups[p.teamId].filter((u) => u.players.includes(p.personId));
        const [m, s] = p.minutes.split(":").map(Number);
        const seconds = units.reduce((sum, u) => sum + u.seconds, 0);
        assert.ok(Math.abs(seconds - (m * 60 + s)) <= 1, `${p.familyName}: ${seconds}s vs ${p.minutes}`);
        assert.equal(units.reduce((sum, u) => sum + u.pts_for - u.pts_against, 0), p.plusMinusPoints, p.familyName);
      }
    }
  });
});
