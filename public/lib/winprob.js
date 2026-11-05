// Win probability from the score and the time left, with Hal Stern's
// random-walk model: the home margin drifts from here to the final buzzer by
// about WP_SIGMA points over a whole game, plus home-court edge, so
//   P(home wins) = Φ((margin + edge·r ± ball) / √(σ²·r + late²)),
// r = share of the game left. Having the ball is worth POSSESSION_POINTS to
// the team that has it. The late-game floor keeps the last seconds from
// looking settled: one possession can still swing the margin by 3. It doesn't
// know team strength.

// Spread of a full game's final margin, and the home team's edge, in points.
const WP_SIGMA = 13;
const WP_HOME_EDGE = 2.5;

// What having the ball is worth, in points, and the least the margin can
// still move however little time is left. Both were checked against 74 cached
// games' results (Brier score over every play): a floor of 2 helped most at
// every stage of the fourth quarter, and 0.4 points of possession helped a
// little over the last five and two minutes (not the last 30 seconds, though
// that's only a handful of close finishes).
const POSSESSION_POINTS = 0.4;
const WP_LATE_SD = 2;
export const REGULATION_SECONDS = 2880;

// Standard normal CDF, via Abramowitz & Stegun 7.1.26 (error under 1.5e-7).
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-x * x);
  if (z >= 0) {
    return 0.5 * (1 + erf);
  }

  return 0.5 * (1 - erf);
}

// Seconds left to decide the game at time t: to the end of regulation, or in
// overtime, to the end of the current overtime.
export function gameSecondsLeft(t) {
  // The final buzzer of regulation still belongs to regulation: a game
  // decided then is over, not five minutes from over.
  if (t <= REGULATION_SECONDS) {
    return REGULATION_SECONDS - t;
  }

  const overtimes = Math.max(Math.ceil((t - REGULATION_SECONDS) / 300), 1);
  return REGULATION_SECONDS + overtimes * 300 - t;
}

// The home team's chance of winning with this score at time t, when `ball`
// ("home", "away", or null when unknown) has possession.
export function homeWinProb(score, t, ball = null) {
  let margin = score.home - score.away;
  const r = gameSecondsLeft(t) / REGULATION_SECONDS;
  if (r <= 0) {
    if (margin > 0) {
      return 1;
    }
    if (margin < 0) {
      return 0;
    }
    return 0.5;
  }

  if (ball === "home") {
    margin += POSSESSION_POINTS;
  } else if (ball === "away") {
    margin -= POSSESSION_POINTS;
  }
  const spread = Math.sqrt(WP_SIGMA ** 2 * r + WP_LATE_SD ** 2);
  return normalCdf((margin + WP_HOME_EDGE * r) / spread);
}

// A side's chance of winning, from the home team's, as "87%" (">99%" and
// "<1%" at the extremes, which the rounding would otherwise call certain).
export function pctLabel(p) {
  if (p > 0.995 && p < 1) {
    return ">99%";
  }
  if (p < 0.005 && p > 0) {
    return "<1%";
  }

  return `${Math.round(p * 100)}%`;
}

export function sideWinProb(homeProb, side) {
  if (side === "home") {
    return homeProb;
  }

  return 1 - homeProb;
}
