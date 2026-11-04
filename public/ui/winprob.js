// The win probability line on the scoring trend, and the swings in it.
import { loadPref, savePref } from "../lib/prefs.js";
import { playByPlay } from "./games.js";
import { state } from "./state.js";
import { hideTooltip } from "./tooltip.js";
import { drawScoreTrend, gameSeconds, otherSide } from "./trend.js";

// Win probability (a trial, toggled on the scoring trend). Hal Stern's
// random-walk model: the home margin drifts from here to the final buzzer by
// about WP_SIGMA points over a whole game, plus home-court edge, so
//   P(home wins) = Φ((margin + edge·r ± ball) / √(σ²·r + late²)),
// r = share of the game left. Having the ball is worth POSSESSION_POINTS to
// the team that has it. The late-game floor keeps the last seconds from
// looking settled: one possession can still swing the margin by 3. It doesn't
// know team strength.
export let showWinProb = loadPref("winProb", false) === true;

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
const REGULATION_SECONDS = 2880;

// A win-probability move that counts as a momentum swing (20 points), made
// within SWING_MAX_SECONDS of game time. Without the time limit, a team that
// pulls away slowly all game would make one game-long "swing".
export const SWING_MIN = 0.2;
export const SWING_MAX_SECONDS = 360;

// Game seconds between samples of the drawn win-probability line.
const WP_STEP = 6;

// Standard normal CDF, via Abramowitz & Stegun 7.1.26 (error under 1.5e-7).
function normalCdf(z) {
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
function gameSecondsLeft(t) {
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

// Which side has the ball after a play ("home", "away", or null), from the
// team the API names.
export function ballSide(play) {
  if (!play.possession) {
    return null;
  }
  if (play.possession === state.currentGame.home.abbreviation) {
    return "home";
  }

  return "away";
}

// Who has the ball at time t: as of the last play by then.
export function possessionAt(t) {
  let ball = null;
  for (const play of playByPlay) {
    if (!play.clock) {
      continue;
    }
    if (gameSeconds(play) > t) {
      break;
    }
    ball = ballSide(play);
  }
  return ball;
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

// "BOS 87% to win" for whichever team is favored.
export function favoredLabel(homeProb) {
  let side = "home";
  if (homeProb < 0.5) {
    side = "away";
  }
  return `${state.currentGame[side].abbreviation} ${pctLabel(sideWinProb(homeProb, side))} to win`;
}

// Stretches of at most SWING_MAX_SECONDS that moved one team's win
// probability by SWING_MIN or more, shaped like scoringRuns' runs (plus wpFrom/wpTo, the home team's chance
// before and after) so the chart draws and hovers them the same way. Each
// starts and ends with a basket by the team that gained; overlapping
// candidates give way to bigger swings.
export function momentumSwings() {
  const plays = [];
  let before = { away: 0, home: 0 };
  let ball = null;
  for (const play of playByPlay) {
    if (!play.clock) {
      continue;
    }
    if (!play.scored) {
      ball = ballSide(play);
      continue;
    }

    let side = "away";
    if (play.score.home > before.home) {
      side = "home";
    }
    const t = gameSeconds(play);
    plays.push({
      play,
      side,
      from: before,
      t,
      wpBefore: homeWinProb(before, t, ball),
      wpAfter: homeWinProb(play.score, t, ballSide(play)),
    });
    before = play.score;
    ball = ballSide(play);
  }

  const candidates = [];
  plays.forEach((first, i) => {
    let best = null;
    for (let j = i; j < plays.length && plays[j].t - first.t <= SWING_MAX_SECONDS; j++) {
      const last = plays[j];
      if (last.side !== first.side) {
        continue;
      }

      const gain = sideWinProb(last.wpAfter, first.side) - sideWinProb(first.wpBefore, first.side);
      if (gain >= SWING_MIN && (!best || gain > best.gain)) {
        best = { i, j, gain };
      }
    }
    if (best) {
      candidates.push(best);
    }
  });

  const kept = [];
  candidates.sort((a, b) => b.gain - a.gain);
  for (const swing of candidates) {
    if (kept.every((k) => swing.j < k.i || swing.i > k.j)) {
      kept.push(swing);
    }
  }

  return kept
    .sort((a, b) => a.i - b.i)
    .map(({ i, j }) => {
      const stretch = plays.slice(i, j + 1);
      const side = plays[i].side;
      const from = plays[i].from;
      const to = plays[j].play.score;
      return {
        kind: "swing",
        side,
        from,
        to,
        points: to[side] - from[side],
        allowed: to[otherSide(side)] - from[otherSide(side)],
        wpFrom: plays[i].wpBefore,
        wpTo: plays[j].wpAfter,
        plays: stretch.filter((p) => p.side === side).map((p) => p.play),
        tStart: plays[i].t,
        tEnd: plays[j].t,
      };
    });
}

// The home team's win probability across the chart, sampled every WP_STEP
// game seconds and on both sides of each play that changes the score or the
// ball (where it jumps).
export function winProbPath(series, sx, syProb) {
  const { first, last, t0, t1, start } = series;
  const points = [];
  let score = start;
  let ball = null;
  const add = (time) => points.push(`${sx(time)} ${syProb(homeWinProb(score, time, ball))}`);
  let t = t0;
  for (const play of playByPlay) {
    if (!play.clock || play.period < first || play.period > last) {
      continue;
    }

    const nextBall = ballSide(play);
    if (nextBall === ball && play.score.home === score.home && play.score.away === score.away) {
      continue;
    }

    const at = gameSeconds(play);
    for (; t < at; t += WP_STEP) {
      add(t);
    }
    add(at);
    score = play.score;
    ball = nextBall;
    add(at);
    t = at + WP_STEP;
  }
  for (; t < t1; t += WP_STEP) {
    add(t);
  }
  add(t1);
  return `M ${points.join(" L ")}`;
}

export function toggleWinProb(event) {
  if (event.target.id !== "winProbToggle") {
    return;
  }

  showWinProb = event.target.checked;
  savePref("winProb", showWinProb);
  track("win_prob_toggle", { on: showWinProb });
  hideTooltip();
  drawScoreTrend();
}
