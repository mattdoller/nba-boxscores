import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SeasonType,
  seasonFromGameId,
  seasonString,
  seasonTypeFromGameId,
} from "../../nba-api/parameters.js";

describe("seasonString", () => {
  it("labels a season by its start and end years", () => {
    assert.equal(seasonString(2024), "2024-25");
  });

  it("wraps the end year across a century", () => {
    assert.equal(seasonString(1999), "1999-00");
  });

  it("accepts a year as a string", () => {
    assert.equal(seasonString("2009"), "2009-10");
  });
});

describe("seasonTypeFromGameId", () => {
  it("reads the season type from the third digit", () => {
    assert.equal(seasonTypeFromGameId("0012400001"), SeasonType.preseason);
    assert.equal(seasonTypeFromGameId("0022400001"), SeasonType.regular);
    assert.equal(seasonTypeFromGameId("0032400001"), SeasonType.allStar);
    assert.equal(seasonTypeFromGameId("0042400101"), SeasonType.playoffs);
    assert.equal(seasonTypeFromGameId("0052400101"), SeasonType.playIn);
  });

  it("returns undefined for an unknown season type", () => {
    assert.equal(seasonTypeFromGameId("0092400001"), undefined);
  });
});

describe("seasonFromGameId", () => {
  it("reads a 2000s season", () => {
    assert.equal(seasonFromGameId("0022400001"), 2024);
    assert.equal(seasonFromGameId("0020000001"), 2000);
  });

  it("reads a 1900s season back to the league's first", () => {
    assert.equal(seasonFromGameId("0029600001"), 1996);
    assert.equal(seasonFromGameId("0024600001"), 1946);
  });
});
