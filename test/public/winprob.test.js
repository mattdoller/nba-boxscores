import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REGULATION_SECONDS,
  gameSecondsLeft,
  homeWinProb,
  normalCdf,
  pctLabel,
  sideWinProb,
} from "../../public/lib/winprob.js";

const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

describe("normalCdf", () => {
  it("matches the standard normal distribution", () => {
    near(normalCdf(0), 0.5);
    near(normalCdf(1), 0.841345);
    near(normalCdf(-1.96), 0.024998);
    near(normalCdf(3), 0.99865);
  });

  it("is symmetric about zero", () => {
    for (const z of [0.3, 1.2, 2.5]) {
      near(normalCdf(z) + normalCdf(-z), 1);
    }
  });
});

describe("gameSecondsLeft", () => {
  it("counts down to the end of regulation", () => {
    assert.equal(gameSecondsLeft(0), REGULATION_SECONDS);
    assert.equal(gameSecondsLeft(2000), 880);
    assert.equal(gameSecondsLeft(REGULATION_SECONDS), 0);
  });

  it("counts down to the end of the current overtime", () => {
    assert.equal(gameSecondsLeft(REGULATION_SECONDS + 1), 299);
    assert.equal(gameSecondsLeft(REGULATION_SECONDS + 300), 0);
    assert.equal(gameSecondsLeft(REGULATION_SECONDS + 420), 180);
  });
});

describe("homeWinProb", () => {
  it("favors the home team a little at tip-off", () => {
    const p = homeWinProb({ home: 0, away: 0 }, 0);
    assert.ok(p > 0.5 && p < 0.6, `${p}`);
  });

  it("grows with the home lead", () => {
    const t = 1440;
    const probs = [-10, -3, 0, 3, 10].map((lead) => homeWinProb({ home: 50 + lead, away: 50 }, t));
    for (let i = 1; i < probs.length; i++) {
      assert.ok(probs[i] > probs[i - 1], `${probs}`);
    }
  });

  it("makes the same lead count for more as time runs out", () => {
    const score = { home: 90, away: 84 };
    assert.ok(homeWinProb(score, 2700) > homeWinProb(score, 1440));
    assert.ok(homeWinProb(score, 1440) > homeWinProb(score, 300));
  });

  it("is settled once the game is over", () => {
    assert.equal(homeWinProb({ home: 100, away: 99 }, REGULATION_SECONDS), 1);
    assert.equal(homeWinProb({ home: 99, away: 100 }, REGULATION_SECONDS), 0);
    assert.equal(homeWinProb({ home: 100, away: 100 }, REGULATION_SECONDS), 0.5);
  });

  it("still leaves a one-possession game open in the last seconds", () => {
    const p = homeWinProb({ home: 100, away: 98 }, REGULATION_SECONDS - 5);
    assert.ok(p > 0.75 && p < 0.99, `${p}`);
  });

  it("gives an edge to the team with the ball", () => {
    const score = { home: 100, away: 100 };
    const t = REGULATION_SECONDS - 60;
    assert.ok(homeWinProb(score, t, "home") > homeWinProb(score, t));
    assert.ok(homeWinProb(score, t, "away") < homeWinProb(score, t));
  });
});

describe("sideWinProb", () => {
  it("turns the home team's chance into either side's", () => {
    assert.equal(sideWinProb(0.7, "home"), 0.7);
    near(sideWinProb(0.7, "away"), 0.3);
  });
});

describe("pctLabel", () => {
  it("rounds to a whole percent", () => {
    assert.equal(pctLabel(0.874), "87%");
    assert.equal(pctLabel(0.5), "50%");
  });

  it("doesn't round a near-certainty into a certainty", () => {
    assert.equal(pctLabel(0.997), ">99%");
    assert.equal(pctLabel(0.003), "<1%");
    assert.equal(pctLabel(1), "100%");
    assert.equal(pctLabel(0), "0%");
  });
});
