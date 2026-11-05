// The win probability line on the scoring trend, and the swings in it.
import { loadPref, savePref } from "../lib/prefs.js";
import { homeWinProb, pctLabel, sideWinProb } from "../lib/winprob.js";
import { playByPlay } from "./games.js";
import { state } from "./state.js";
import { hideTooltip } from "./tooltip.js";
import { drawScoreTrend, gameSeconds, otherSide } from "./trend.js";

// Win probability on the scoring trend (a trial, off until switched on and
// remembered). The model is in lib/winprob.js.
export let showWinProb = loadPref("winProb", false) === true;

// A win-probability move that counts as a momentum swing (20 points), made
// within SWING_MAX_SECONDS of game time. Without the time limit, a team that
// pulls away slowly all game would make one game-long "swing".
export const SWING_MIN = 0.2;
export const SWING_MAX_SECONDS = 360;

// Game seconds between samples of the drawn win-probability line.
const WP_STEP = 6;

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

// "BOS 87% to win" for whichever team is favored.
export function favoredLabel(homeProb) {
  let side = "home";
  if (homeProb < 0.5) {
    side = "away";
  }
  return `${state.currentGame[side].abbreviation} ${pctLabel(sideWinProb(homeProb, side))} to win`;
}

// Every scoring play with the home team's chance of winning just before and
// just after it, at the moment it happened: { play, side (who scored), from
// (the score before), t, wpBefore, wpAfter }.
function scoringPlays() {
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
  return plays;
}

// The plays that moved the scoring team's chance of winning the most, by
// how much (`gain`, 0–1), biggest first.
export function biggestPlays(count) {
  return scoringPlays()
    .map((entry) => ({
      ...entry,
      gain: sideWinProb(entry.wpAfter, entry.side) - sideWinProb(entry.wpBefore, entry.side),
    }))
    .sort((a, b) => b.gain - a.gain || a.t - b.t)
    .slice(0, count);
}

// Stretches of at most SWING_MAX_SECONDS that moved one team's win
// probability by SWING_MIN or more, shaped like scoringRuns' runs (plus wpFrom/wpTo, the home team's chance
// before and after) so the chart draws and hovers them the same way. Each
// starts and ends with a basket by the team that gained; overlapping
// candidates give way to bigger swings.
export function momentumSwings() {
  const plays = scoringPlays();

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
