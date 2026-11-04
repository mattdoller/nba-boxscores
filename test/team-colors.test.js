import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTeams } from "../nba-api/index.js";
import { teamColors } from "../team-colors.js";

describe("teamColors", () => {
  it("has hex primary and secondary colors for every team", () => {
    for (const team of getTeams()) {
      const colors = teamColors(team.id);

      assert.match(colors?.primary ?? "", /^#[0-9a-f]{6}$/, team.full_name);
      assert.match(colors?.secondary ?? "", /^#[0-9a-f]{6}$/, team.full_name);
    }
  });

  it("returns null for an unknown team", () => {
    assert.equal(teamColors(1), null);
  });
});
