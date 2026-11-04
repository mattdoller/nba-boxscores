import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findTeamById, getTeams } from "../../nba-api/static/teams.js";

describe("getTeams", () => {
  it("lists the 30 current franchises with unique ids and abbreviations", () => {
    const teams = getTeams();

    assert.equal(teams.length, 30);
    assert.equal(new Set(teams.map((t) => t.id)).size, 30);
    assert.equal(new Set(teams.map((t) => t.abbreviation)).size, 30);
  });

  it("describes each team", () => {
    assert.deepEqual(getTeams()[0], {
      id: 1610612737,
      abbreviation: "ATL",
      nickname: "Hawks",
      city: "Atlanta",
      full_name: "Atlanta Hawks",
    });
  });
});

describe("findTeamById", () => {
  it("finds a team by numeric or string id", () => {
    assert.equal(findTeamById(1610612747).full_name, "Los Angeles Lakers");
    assert.equal(findTeamById("1610612747").full_name, "Los Angeles Lakers");
  });

  it("returns undefined for an unknown id", () => {
    assert.equal(findTeamById(1), undefined);
  });
});
