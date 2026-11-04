// The scoring trend: the running score over the game, its scoring runs,
// and the playhead that follows playback.
import { escapeHtml, periodLabel, round1 } from "../lib/format.js";
import { gamePeriods } from "./filters.js";
import { scoreHeld } from "./flights.js";
import { playByPlay } from "./games.js";
import { playback } from "./playback.js";
import { drawCourtTrend } from "./shotchart.js";
import { state } from "./state.js";
import { momentumSwings, showWinProb, SWING_MAX_SECONDS, SWING_MIN, winProbPath } from "./winprob.js";

// Scoring trend: each team's running score over game time, as step lines
// (the score only changes at scoring plays). Follows the quarter selector.

// The chart gets taller as it gets wider (e.g. with the control panel
// collapsed), keeping roughly this shape, but never shorter than
// TREND_MIN_HEIGHT.
const TREND_MIN_HEIGHT = 260;
const TREND_ASPECT = 0.26;
const TREND_MARGIN = { top: 16, right: 72, bottom: 28, left: 40 };

// Set on each draw so hover and keyboard handlers can map back to the data.
export let trend = null;

// Regulation quarters are 12 minutes; overtimes are 5.
export function periodLength(period) {
  if (period <= 4) {
    return 720;
  }
  return 300;
}

export function periodStart(period) {
  let total = 0;
  for (let p = 1; p < period; p++) {
    total += periodLength(p);
  }
  return total;
}

// The selected periods and their span in seconds since tip-off.
export function selectedWindow() {
  let first = 1;
  let last = gamePeriods().length;
  if (state.selectedPeriod !== "all") {
    first = state.selectedPeriod;
    last = state.selectedPeriod;
  }
  return { first, last, t0: periodStart(first), t1: periodStart(last) + periodLength(last) };
}

// Seconds since tip-off for a play or shot whose clock reads "M:SS" remaining.
export function gameSeconds(play) {
  const [minutes, seconds] = play.clock.split(":").map(Number);
  return periodStart(play.period) + periodLength(play.period) - (minutes * 60 + seconds);
}

// sRGB hex -> OKLab, for judging whether two team colors are distinguishable.
function oklab(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    if (c <= 0.04045) {
      return c / 12.92;
    }
    return ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

// OKLab back to "#rrggbb", clamping anything outside sRGB.
function fromOklab({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${linear.map((c) => {
    let v = 12.92 * c;
    if (c > 0.0031308) {
      v = 1.055 * c ** (1 / 2.4) - 0.055;
    }
    return Math.round(Math.min(Math.max(v, 0), 1) * 255).toString(16).padStart(2, "0");
  }).join("")}`;
}

export function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

// Lightness a team color needs to stand out on the night-mode background.
const DARK_MIN_LIGHTNESS = 0.65;

// A team color as shown in the current theme: unchanged by day; at night,
// dark colors (navy, black) are lifted to DARK_MIN_LIGHTNESS, keeping their hue.
export function teamColor(hex) {
  if (!isDark() || !/^#[0-9a-f]{6}$/i.test(hex)) {
    return hex;
  }

  const lab = oklab(hex);
  if (lab.L >= DARK_MIN_LIGHTNESS) {
    return hex;
  }
  return fromOklab({ ...lab, L: DARK_MIN_LIGHTNESS });
}

// Perceptual distance (OKLab ΔE × 100); under ~15 two lines read as one color.
function colorDistance(hexA, hexB) {
  const a = oklab(hexA);
  const b = oklab(hexB);
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b) * 100;
}

// Each team's primary color. When the two clash (e.g. Knicks and 76ers share
// a blue), the away team falls back to its secondary color, or gray if that's
// too light to see on white (by day) or clashes too.
export function trendColors() {
  const { away, home } = state.currentGame;
  const homeColor = teamColor(home.colors?.primary ?? "#1c1f24");
  let awayColor = teamColor(away.colors?.primary ?? "#6b7280");
  if (colorDistance(homeColor, awayColor) < 15) {
    const alt = away.colors?.secondary && teamColor(away.colors.secondary);
    if (alt && (isDark() || oklab(alt).L < 0.9) && colorDistance(homeColor, alt) >= 15) {
      awayColor = alt;
    } else {
      awayColor = "#9ca3af";
    }
  }
  return { away: awayColor, home: homeColor };
}

// A tick step that gives roughly four gridlines over the range.
function niceStep(range) {
  for (const step of [1, 2, 5, 10, 20, 25, 50]) {
    if (step >= range / 4) {
      return step;
    }
  }
  return 50;
}

export function drawScoreTrend() {
  const el = document.getElementById("scoretrend");
  if (!el || !playByPlay) {
    return;
  }

  // A collapsed section has no width to draw at. Skip it; trendObserver
  // draws the chart when the section opens again.
  trendWidth = el.clientWidth;
  if (trendWidth > 0) {
    el.innerHTML = renderScoreTrend(trendWidth);
  }
  applyTrendPlayhead();
}

// During shot chart playback the lines draw only up to the playhead and the
// final-score labels wait for the end; otherwise the whole chart shows.
export function applyTrendPlayhead() {
  drawCourtTrend();
  const svg = document.querySelector(".trend svg");
  if (!svg || !trend) {
    return;
  }

  let width = trend.width;
  const playing = playback && playback.playhead < playback.t1;
  if (playing) {
    width = trend.sx(playback.playhead);
    // A step at the playhead belongs to the shot in the air; keep it hidden
    // (the line is 2px wide) until the shot reaches the hoop, as on the court.
    if (scoreHeld()) {
      width -= 2;
    }
  }
  svg.querySelector(".trend-clip").setAttribute("width", width);
  svg.classList.toggle("playing", Boolean(playing));
  drawTrendHeads(svg, playing);
}

// During playback a dot and the current score ride the head of each line, as
// on the shot chart floor. The scores sit just ahead of the heads, in the part
// of the chart not drawn yet: the leader's above its line, the trailer's below.
function drawTrendHeads(svg, playing) {
  const heads = svg.querySelector(".trend-heads");
  if (!playing) {
    heads.setAttribute("visibility", "hidden");
    return;
  }

  const t = playback.playhead;
  const held = scoreHeld();
  const score = trend.events.filter((e) => e.t < t || (e.t === t && !held)).at(-1)?.play.score ?? trend.start;
  const x = trend.sx(Math.max(t, trend.t0));
  for (const side of ["away", "home"]) {
    const y = trend.sy(score[side]);
    const dot = heads.querySelector(`.head-${side}`);
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", y);

    const other = otherSide(side);
    let labelY = y - 8;
    if (score[side] < score[other] || (score[side] === score[other] && side === "away")) {
      labelY = y + 16;
    }
    const label = heads.querySelector(`.score-${side}`);
    label.textContent = score[side];
    label.setAttribute("x", x + 6);
    label.setAttribute("y", labelY);
  }
  heads.setAttribute("visibility", "visible");
}

// Scoring plays the chart has drawn so far (all of them outside playback).
export function visibleEvents() {
  if (!playback) {
    return trend.events;
  }
  return trend.events.filter((e) => e.t <= playback.playhead);
}

// Redraws at the container's width so text stays a fixed size.
// Width the chart was last drawn at (0 when skipped while collapsed).
let trendWidth = 0;
export const trendObserver = new ResizeObserver(([entry]) => {
  const width = Math.round(entry.contentRect.width);
  // Collapsing shrinks the width to 0; leave the chart (and any selection)
  // alone then, and redraw only when it opens at a different width.
  if (width > 0 && width !== trendWidth) {
    drawScoreTrend();
  }
});

// The running score over the selected periods: the score entering them, their
// scoring plays, and the score range an axis needs. Null without play-by-play.
// Shared by the scoring trend and its copy on the shot chart floor.
export function trendSeries() {
  const timed = playByPlay.filter((p) => p.clock);
  if (timed.length === 0) {
    return null;
  }

  const { first, last, t0, t1 } = selectedWindow();
  const start = timed.filter((p) => p.period < first).at(-1)?.score ?? { away: 0, home: 0 };
  const events = timed
    .filter((p) => p.scored && p.period >= first && p.period <= last)
    .map((p) => ({ t: gameSeconds(p), play: p }));
  const end = events.at(-1)?.play.score ?? start;

  // A single quarter starts its axis near the score entering it, so the
  // quarter's runs aren't flattened against the whole game's range.
  let low = 0;
  if (state.selectedPeriod !== "all") {
    low = Math.min(start.away, start.home);
  }
  const high = Math.max(end.away, end.home, low + 1);
  const step = niceStep(high - low);
  return {
    first,
    last,
    t0,
    t1,
    start,
    events,
    end,
    step,
    yMin: Math.floor(low / step) * step,
    yMax: Math.ceil(high / step) * step,
  };
}

// What makes a stretch a run worth shading on the trend: one team scores at
// least RUN_MIN_POINTS, and at least RUN_RATIO points for every point it
// allows. So 6–0 or better unanswered, 7–1, 14–2, and so on.
const RUN_MIN_POINTS = 6;
const RUN_RATIO = 7;

function isRun(points, allowed) {
  return points >= RUN_MIN_POINTS && points >= RUN_RATIO * allowed;
}

// The game's runs, in order. Found over the whole game, so a run can span
// quarters. Each starts and ends with a basket by the running team.
//
// From each basket, the run is the longest stretch that still qualifies and
// ends on that team's basket. Those overlap (a 6–0 burst, a free throw
// against, then an 8–0 burst is one 14–1 run), so the biggest margins are
// kept first and anything overlapping them is dropped.
function scoringRuns() {
  const plays = [];
  let before = { away: 0, home: 0 };
  for (const play of playByPlay) {
    if (!play.clock || !play.scored) {
      continue;
    }

    let side = "away";
    if (play.score.home > before.home) {
      side = "home";
    }
    plays.push({ play, side, from: before });
    before = play.score;
  }

  const candidates = [];
  plays.forEach((first, i) => {
    let best = null;
    for (let j = i; j < plays.length; j++) {
      const last = plays[j];
      if (last.side !== first.side) {
        continue;
      }

      const to = last.play.score;
      const other = otherSide(first.side);
      const points = to[first.side] - first.from[first.side];
      const allowed = to[other] - first.from[other];
      if (isRun(points, allowed)) {
        best = { i, j, side: first.side, from: first.from, to, points, allowed };
      }
    }
    if (best) {
      candidates.push(best);
    }
  });

  const kept = [];
  candidates.sort((a, b) => (b.points - b.allowed) - (a.points - a.allowed) || (b.j - b.i) - (a.j - a.i));
  for (const run of candidates) {
    if (kept.every((k) => run.j < k.i || run.i > k.j)) {
      kept.push(run);
    }
  }

  return kept
    .sort((a, b) => a.i - b.i)
    .map((run) => {
      const stretch = plays.slice(run.i, run.j + 1);
      return {
        side: run.side,
        from: run.from,
        to: run.to,
        points: run.points,
        allowed: run.allowed,
        // The running team's baskets, for its high scorer and basket count.
        plays: stretch.filter((p) => p.side === run.side).map((p) => p.play),
        tStart: gameSeconds(stretch[0].play),
        tEnd: gameSeconds(stretch.at(-1).play),
      };
    });
}

export function otherSide(side) {
  if (side === "away") {
    return "home";
  }

  return "away";
}

// Narrowest a run block is drawn, so a quick run is still easy to hover.
const RUN_MIN_WIDTH = 6;

// A run's block on the trend, clipped to the chart's window.
export function runBox(run) {
  let x = trend.sx(Math.max(run.tStart, trend.t0));
  let w = trend.sx(Math.min(run.tEnd, trend.t1)) - x;
  if (w < RUN_MIN_WIDTH) {
    x -= (RUN_MIN_WIDTH - w) / 2;
    w = RUN_MIN_WIDTH;
  }
  return { x: round1(x), w: round1(w) };
}

function renderScoreTrend(width) {
  const series = trendSeries();
  if (!series) {
    trend = null;
    return '<p class="hint">No play-by-play for this game.</p>';
  }

  const { away, home } = state.currentGame;
  const colors = trendColors();
  const periods = gamePeriods();
  const { first, t0, t1, start, events, end, step, yMin, yMax } = series;

  const height = Math.max(TREND_MIN_HEIGHT, Math.round(width * TREND_ASPECT));
  const m = TREND_MARGIN;
  const plotW = Math.max(width - m.left - m.right, 100);
  const plotH = height - m.top - m.bottom;
  const sx = (t) => round1(m.left + ((t - t0) / (t1 - t0)) * plotW);
  const sy = (v) => round1(m.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH);
  // Shaded spans: scoring runs, or with win probability on, momentum swings.
  let spans = scoringRuns();
  if (showWinProb) {
    spans = momentumSwings();
  }
  const runs = spans.filter((run) => run.tEnd >= t0 && run.tStart <= t1);
  trend = { events, colors, sx, sy, width, start, t0, t1, left: m.left, plotW, runs };
  // A redraw can change the window (another quarter), so any range goes.
  state.trendSelection = null;
  state.trendAnchor = null;

  const yTicks = [];
  for (let v = yMin; v <= yMax; v += step) {
    yTicks.push(`
      <line class="grid" x1="${m.left}" x2="${m.left + plotW}" y1="${sy(v)}" y2="${sy(v)}" />
      <text class="tick" x="${m.left - 8}" y="${sy(v)}" text-anchor="end" dominant-baseline="middle">${v}</text>`);
  }

  // All quarters: a label per period with a divider between them. One quarter:
  // the time remaining every 3 minutes (every minute in overtime).
  const xTicks = [];
  if (state.selectedPeriod === "all") {
    for (const p of periods) {
      const left = sx(periodStart(p));
      if (p > 1) {
        xTicks.push(`<line class="grid" x1="${left}" x2="${left}" y1="${m.top}" y2="${m.top + plotH}" />`);
      }
      const mid = sx(periodStart(p) + periodLength(p) / 2);
      xTicks.push(`<text class="tick" x="${mid}" y="${height - 8}" text-anchor="middle">${escapeHtml(periodLabel(p))}</text>`);
    }
  } else {
    const every = periodLength(first) > 300 ? 180 : 60;
    for (let left = periodLength(first); left >= 0; left -= every) {
      const x = sx(t1 - left);
      let anchor = "middle";
      if (left === periodLength(first)) {
        anchor = "start";
      } else if (left === 0) {
        anchor = "end";
      }
      xTicks.push(`<text class="tick" x="${x}" y="${height - 8}" text-anchor="${anchor}">${left / 60}:00</text>`);
    }
  }

  const path = (side) => {
    let d = `M ${sx(t0)} ${sy(start[side])}`;
    for (const e of events) {
      d += ` H ${sx(e.t)} V ${sy(e.play.score[side])}`;
    }
    return `${d} H ${sx(t1)}`;
  };

  // Final values at the line ends, unless they'd overlap; the legend and
  // tooltip still carry them then.
  let endLabels = "";
  if (Math.abs(sy(end.away) - sy(end.home)) >= 14) {
    endLabels = [[away, end.away], [home, end.home]].map(([team, value]) => `
      <text class="end-label" x="${m.left + plotW + 8}" y="${sy(value)}" dominant-baseline="middle">
        <tspan class="end-value">${value}</tspan> ${escapeHtml(team.abbreviation)}</text>`).join("");
  }

  let legend = [[away, colors.away], [home, colors.home]].map(([team, color]) => `
    <span><span class="line-key" style="background: ${escapeHtml(color)}"></span>${escapeHtml(team.full_name)}</span>`).join("");
  if (showWinProb) {
    legend += `
      <span><span class="line-key wp-key" style="--above: ${escapeHtml(colors.home)}; --below: ${escapeHtml(colors.away)}"></span>
        Win probability (above the middle: ${escapeHtml(home.abbreviation)} favored)</span>`;
  }
  legend += `
    <label class="chart-toggle">
      <input type="checkbox" id="winProbToggle"${showWinProb ? " checked" : ""}> Win probability
    </label>`;

  // The home team's win probability, 100% at the top of the plot and 0% at
  // the bottom: in its color above the 50% line and the away team's below.
  let winProb = "";
  if (showWinProb) {
    const syProb = (p) => round1(m.top + (1 - p) * plotH);
    const mid = syProb(0.5);
    const d = winProbPath(series, sx, syProb);
    winProb = `
      <clipPath id="wpAbove"><rect x="0" y="0" width="${width}" height="${mid}" /></clipPath>
      <clipPath id="wpBelow"><rect x="0" y="${mid}" width="${width}" height="${height - mid}" /></clipPath>
      <line class="wp-mid" x1="${m.left}" x2="${m.left + plotW}" y1="${mid}" y2="${mid}" />
      <path class="wp-line" d="${d}" stroke="${escapeHtml(colors.home)}" clip-path="url(#wpAbove)" />
      <path class="wp-line" d="${d}" stroke="${escapeHtml(colors.away)}" clip-path="url(#wpBelow)" />`;
  }

  // Each run shaded in its team's color, under the lines.
  const runBlocks = runs.map((run, i) => {
    const { x, w } = runBox(run);
    const color = escapeHtml(colors[run.side]);
    return `<rect class="trend-run" data-run="${i}" x="${x}" y="${m.top}" width="${w}" height="${plotH}" fill="${color}" stroke="${color}" />`;
  }).join("");
  let noun = "run";
  let rule = `${RUN_MIN_POINTS} or more points at ${RUN_RATIO} or more for each allowed`;
  let hint = `Shaded spans are runs: ${RUN_MIN_POINTS} or more unanswered points, or ${RUN_RATIO} or more for every point allowed (${RUN_RATIO}–1, ${RUN_RATIO * 2}–2…).`;
  if (showWinProb) {
    noun = "momentum swing";
    rule = `stretches of up to ${SWING_MAX_SECONDS / 60} minutes that moved a team's win probability ${SWING_MIN * 100} points or more`;
    hint = `The two-color line is ${home.abbreviation}'s chance to win, from the score and time left. Shaded spans are momentum swings: stretches of up to ${SWING_MAX_SECONDS / 60} minutes that moved a team's chances ${SWING_MIN * 100} points or more.`;
  }
  let runsLabel = `No ${noun}s`;
  if (runs.length === 1) {
    runsLabel = `1 ${noun}`;
  } else if (runs.length > 1) {
    runsLabel = `${runs.length} ${noun}s`;
  }

  return `
    <figure class="trend">
      <figcaption class="trend-legend">${legend}</figcaption>
      <svg width="${width}" height="${height}" tabindex="0" role="img"
        aria-label="Running score: ${escapeHtml(`${away.abbreviation} ${end.away}, ${home.abbreviation} ${end.home}`)}. ${runsLabel}: ${rule}. Use the arrow keys to step through scoring plays.">
        ${yTicks.join("")}
        ${xTicks.join("")}
        <rect class="trend-selection" y="${m.top}" height="${plotH}" visibility="hidden" />
        <clipPath id="trendClip">
          <rect class="trend-clip" x="0" y="0" width="${width}" height="${height}" />
        </clipPath>
        <g clip-path="url(#trendClip)">
          ${runBlocks}
          <path class="trend-line" d="${path("away")}" stroke="${escapeHtml(colors.away)}" />
          <path class="trend-line" d="${path("home")}" stroke="${escapeHtml(colors.home)}" />
          ${winProb}
        </g>
        <g class="end-labels">${endLabels}</g>
        <g class="trend-heads" visibility="hidden">
          <circle class="trend-head head-away" r="4" fill="${escapeHtml(colors.away)}" />
          <circle class="trend-head head-home" r="4" fill="${escapeHtml(colors.home)}" />
          <text class="trend-head-score score-away" fill="${escapeHtml(colors.away)}"></text>
          <text class="trend-head-score score-home" fill="${escapeHtml(colors.home)}"></text>
        </g>
        <g class="crosshair" visibility="hidden">
          <line y1="${m.top}" y2="${m.top + plotH}" />
          <circle class="dot-away" r="4" fill="${escapeHtml(colors.away)}" />
          <circle class="dot-home" r="4" fill="${escapeHtml(colors.home)}" />
        </g>
        <rect class="trend-hit" x="${m.left}" y="0" width="${plotW}" height="${height}" />
      </svg>
      <p class="hint">${escapeHtml(hint)} Hover one for details. Drag across the chart, or click and shift-click, to sum up any stretch of the game.</p>
    </figure>`;
}
