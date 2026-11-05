// Reading the scoring trend: tooltips for points, runs, and swings, and
// selecting a stretch of the game by dragging or with the keyboard.
import { escapeHtml, periodLabel } from "../lib/format.js";
import { homeWinProb, pctLabel, sideWinProb } from "../lib/winprob.js";
import { boxscoreEl } from "./dom.js";
import { gamePeriods } from "./filters.js";
import { playback } from "./playback.js";
import { state } from "./state.js";
import { hideTooltip, showTooltip } from "./tooltip.js";
import { periodLength, periodStart, runBox, trend, visibleEvents } from "./trend.js";
import { ballSide, favoredLabel, possessionAt, showWinProb } from "./winprob.js";

// Index of the scoring play nearest an x position on the chart.
function nearestEvent(x) {
  const events = visibleEvents();
  let best = 0;
  events.forEach((e, i) => {
    if (Math.abs(trend.sx(e.t) - x) < Math.abs(trend.sx(events[best].t) - x)) {
      best = i;
    }
  });
  return best;
}

// Moves the crosshair to a scoring play and shows its tooltip; returns its position.
function showTrendPoint(svg, index, clientX, clientY) {
  const { play, t } = visibleEvents()[index];
  const { away, home } = state.currentGame;
  const x = trend.sx(t);
  const crosshair = svg.querySelector(".crosshair");
  crosshair.setAttribute("visibility", "visible");
  crosshair.querySelector("line").setAttribute("x1", x);
  crosshair.querySelector("line").setAttribute("x2", x);
  for (const side of ["away", "home"]) {
    const dot = crosshair.querySelector(`.dot-${side}`);
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", trend.sy(play.score[side]));
  }
  svg.dataset.index = index;

  const row = (team, side) => `
    <span class="tt-row"><span class="line-key" style="background: ${escapeHtml(trend.colors[side])}"></span>
      <strong>${play.score[side]}</strong> ${escapeHtml(team.abbreviation)}</span>`;
  let winProb = "";
  if (showWinProb) {
    const ball = ballSide(play);
    let label = favoredLabel(homeWinProb(play.score, t, ball));
    if (ball) {
      label += ` · ${state.currentGame[ball].abbreviation} ball`;
    }
    winProb = `<span>${escapeHtml(label)}</span>`;
  }
  const box = svg.getBoundingClientRect();
  showTooltip(`
    ${row(away, "away")}
    ${row(home, "home")}
    ${winProb}
    <span class="muted">${escapeHtml(`${play.period_label} · ${play.clock}`)}</span>
    <span class="muted tt-play">${escapeHtml(play.description)}</span>`,
  clientX ?? box.left + x, clientY ?? box.top + trend.sy(Math.max(play.score.away, play.score.home)));
}

export function hideTrendPoint() {
  const crosshair = boxscoreEl.querySelector(".trend .crosshair");
  crosshair?.setAttribute("visibility", "hidden");
  highlightRun(-1);
}

// Seconds since tip-off at an x position on the chart, clamped to the plot.
function trendTimeAt(x) {
  const t = trend.t0 + ((x - trend.left) / trend.plotW) * (trend.t1 - trend.t0);
  return Math.round(Math.min(Math.max(t, trend.t0), trend.t1));
}

// The score once every scoring play up to time t has counted.
function trendScoreAt(t) {
  return visibleEvents().filter((e) => e.t <= t).at(-1)?.play.score ?? trend.start;
}

// "Q2 5:30" for a time in seconds since tip-off. A time on a period boundary
// reads as the end of the earlier period when `ending`, else the start of the
// later one.
function trendClockLabel(t, ending) {
  const last = gamePeriods().length;
  let period = 1;
  while (period < last && (t > periodStart(period + 1) || (!ending && t === periodStart(period + 1)))) {
    period++;
  }

  const left = periodStart(period) + periodLength(period) - t;
  return `${periodLabel(period)} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

// The selected range in time order, or null when there's none or it's empty.
function trendRange() {
  if (!state.trendSelection || state.trendSelection.from === state.trendSelection.to) {
    return null;
  }

  const { from, to } = state.trendSelection;
  return { a: Math.min(from, to), b: Math.max(from, to) };
}

// Shades the selected range, or hides the shading when there's none.
function drawTrendSelection(svg) {
  const band = svg?.querySelector(".trend-selection");
  if (!band) {
    return;
  }

  const range = trendRange();
  if (!range) {
    band.setAttribute("visibility", "hidden");
    return;
  }

  band.setAttribute("x", trend.sx(range.a));
  band.setAttribute("width", trend.sx(range.b) - trend.sx(range.a));
  band.setAttribute("visibility", "visible");
}

function clearTrendSelection() {
  state.trendSelection = null;
  drawTrendSelection(boxscoreEl.querySelector(".trend svg"));
}

// The players with the most points in a set of scoring plays. Ties are all
// listed; plays without a player (team points) don't count.
function topScorers(plays) {
  const byPlayer = new Map();
  for (const play of plays) {
    if (!play.player_id) {
      continue;
    }

    const scorer = byPlayer.get(play.player_id) ?? { name: play.player, team: play.team, points: 0 };
    scorer.points += play.points ?? 0;
    byPlayer.set(play.player_id, scorer);
  }

  const scorers = [...byPlayer.values()];
  const most = Math.max(0, ...scorers.map((s) => s.points));
  return { points: most, players: scorers.filter((s) => most > 0 && s.points === most) };
}

// Shows the selected range's starting and ending score, each team's points
// in it, and its high scorer.
function showSelectionTooltip(clientX, clientY) {
  const range = trendRange();
  if (!range) {
    return;
  }

  const { away, home } = state.currentGame;
  const first = trendScoreAt(range.a);
  const last = trendScoreAt(range.b);
  const scored = { away: last.away - first.away, home: last.home - first.home };
  const plays = visibleEvents().filter((e) => e.t > range.a && e.t <= range.b).map((e) => e.play);

  let margin = `Even, ${scored.away}–${scored.home}`;
  if (scored.away !== scored.home) {
    let [ahead, behind] = [away, home];
    if (scored.home > scored.away) {
      [ahead, behind] = [home, away];
    }
    margin = `${ahead.abbreviation} outscored ${behind.abbreviation} by ${Math.abs(scored.away - scored.home)}`;
  }

  showTooltip(`
    <span class="muted">${escapeHtml(`${trendClockLabel(range.a, false)} – ${trendClockLabel(range.b, true)}`)}</span>
    ${scoreChangeTable(first, last)}
    <span>${escapeHtml(margin)}</span>
    ${winProbChange(homeWinProb(first, range.a, possessionAt(range.a)), homeWinProb(last, range.b, possessionAt(range.b)))}
    <span><span class="muted">High scorer:</span> ${escapeHtml(highScorerLabel(plays))}</span>`,
  clientX, clientY);
}

// "BOS win probability: 45% → 82% (+37)" for the team whose chances rose, or
// nothing with win probability off.
function winProbChange(before, after) {
  if (!showWinProb) {
    return "";
  }

  let side = "home";
  if (after < before) {
    side = "away";
  }
  const from = sideWinProb(before, side);
  const to = sideWinProb(after, side);
  const change = Math.round((to - from) * 100);
  return `<span><span class="muted">${escapeHtml(state.currentGame[side].abbreviation)} win probability:</span>
    ${escapeHtml(`${pctLabel(from)} → ${pctLabel(to)} (+${change})`)}</span>`;
}

// Each team's score before and after a stretch, and its points in between.
function scoreChangeTable(first, last) {
  const row = (team, side) => `
    <tr>
      <td><span class="tt-row"><span class="line-key" style="background: ${escapeHtml(trend.colors[side])}"></span>${escapeHtml(team.abbreviation)}</span></td>
      <td>${first[side]}</td>
      <td>${last[side]}</td>
      <td><strong>+${last[side] - first[side]}</strong></td>
    </tr>`;
  return `
    <table class="tt-range">
      <thead><tr><th><span class="visually-hidden">Score</span></th><th>Start</th><th>End</th><th>Pts</th></tr></thead>
      <tbody>${row(state.currentGame.away, "away")}${row(state.currentGame.home, "home")}</tbody>
    </table>`;
}

// "J. Tatum (BOS) · 10 pts", with ties all named, or "None".
function highScorerLabel(plays) {
  const top = topScorers(plays);
  if (top.players.length === 0) {
    return "None";
  }

  const names = top.players.map((p) => `${p.name} (${p.team})`).join(", ");
  let unit = "pts";
  if (top.points === 1) {
    unit = "pt";
  }
  return `${names} · ${top.points} ${unit}`;
}

// "BOS by 7", or "Tied".
function leadLabel(score) {
  const { away, home } = state.currentGame;
  if (score.away === score.home) {
    return "Tied";
  }

  let leader = away;
  if (score.home > score.away) {
    leader = home;
  }
  return `${leader.abbreviation} by ${Math.abs(score.away - score.home)}`;
}

// Index of the run whose block is under x, or -1. During playback, only runs
// the playhead has reached count.
function runAt(x) {
  return trend.runs.findIndex((run) => {
    if (playback && run.tStart > playback.playhead) {
      return false;
    }

    const box = runBox(run);
    return x >= box.x && x <= box.x + box.w;
  });
}

// Darkens the hovered run's block; -1 clears it.
function highlightRun(index) {
  for (const block of boxscoreEl.querySelectorAll(".trend-run")) {
    block.classList.toggle("hovered", Number(block.dataset.run) === index);
  }
}

// A momentum swing: whose chances rose and by how much, when and over how
// long, and the score, lead, and high scorer over it.
function showSwingTooltip(swing, clientX, clientY) {
  const team = state.currentGame[swing.side];
  const seconds = swing.tEnd - swing.tStart;
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  showTooltip(`
    <span class="tt-row"><span class="line-key" style="background: ${escapeHtml(trend.colors[swing.side])}"></span>
      <strong>${escapeHtml(`${team.abbreviation} momentum swing · ${swing.points}–${swing.allowed}`)}</strong></span>
    <span class="muted">${escapeHtml(`${trendClockLabel(swing.tStart, false)} – ${trendClockLabel(swing.tEnd, true)} · ${duration} of game time`)}</span>
    ${winProbChange(swing.wpFrom, swing.wpTo)}
    ${scoreChangeTable(swing.from, swing.to)}
    <span><span class="muted">Lead:</span> ${escapeHtml(`${leadLabel(swing.from)} → ${leadLabel(swing.to)}`)}</span>
    <span><span class="muted">High scorer:</span> ${escapeHtml(highScorerLabel(swing.plays))}</span>`,
  clientX, clientY);
}

// A run's team and size, when it happened and how long it took, the score
// and lead before and after, and who scored the most in it.
function showRunTooltip(run, clientX, clientY) {
  const team = state.currentGame[run.side];
  const seconds = run.tEnd - run.tStart;
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  let baskets = `${run.plays.length} ${team.abbreviation} scoring plays in the run`;
  if (run.plays.length === 1) {
    baskets = `1 ${team.abbreviation} scoring play in the run`;
  }

  showTooltip(`
    <span class="tt-row"><span class="line-key" style="background: ${escapeHtml(trend.colors[run.side])}"></span>
      <strong>${escapeHtml(`${team.abbreviation} ${run.points}–${run.allowed} run`)}</strong></span>
    <span class="muted">${escapeHtml(`${trendClockLabel(run.tStart, false)} – ${trendClockLabel(run.tEnd, true)} · ${duration} of game time`)}</span>
    ${scoreChangeTable(run.from, run.to)}
    <span><span class="muted">Lead:</span> ${escapeHtml(`${leadLabel(run.from)} → ${leadLabel(run.to)}`)}</span>
    <span><span class="muted">High scorer:</span> ${escapeHtml(highScorerLabel(run.plays))}</span>
    <span class="muted">${escapeHtml(baskets)}</span>`,
  clientX, clientY);
}

// Returns true when the pointer is over the trend plot.
export function showTrendTooltip(event) {
  const svg = event.target.closest?.(".trend svg");
  if (!svg || !trend || visibleEvents().length === 0 || !event.target.classList.contains("trend-hit")) {
    return false;
  }

  // Over a selected range, sum it up rather than showing one play. Range
  // edges are rounded to whole seconds, so allow a pixel either side.
  const x = event.clientX - svg.getBoundingClientRect().left;
  const range = trendRange();
  if (range && x >= trend.sx(range.a) - 1 && x <= trend.sx(range.b) + 1) {
    hideTrendPoint();
    showSelectionTooltip(event.clientX, event.clientY);
    return true;
  }

  // Over a run, describe the run.
  const run = runAt(x);
  if (run >= 0) {
    hideTrendPoint();
    highlightRun(run);
    if (trend.runs[run].kind === "swing") {
      showSwingTooltip(trend.runs[run], event.clientX, event.clientY);
    } else {
      showRunTooltip(trend.runs[run], event.clientX, event.clientY);
    }
    return true;
  }

  highlightRun(-1);
  showTrendPoint(svg, nearestEvent(x), event.clientX, event.clientY);
  return true;
}

// Pixels the pointer has to move before a press on the trend counts as a drag.
const DRAG_THRESHOLD = 4;

export function startTrendDrag(event) {
  if (event.button !== 0 || !trend || !event.target.classList?.contains("trend-hit")) {
    return;
  }

  const svg = event.target.closest("svg");
  state.trendDrag = { svg, startX: event.clientX - svg.getBoundingClientRect().left, shift: event.shiftKey, moved: false };
  // Keeps the drag going when the pointer leaves the chart.
  event.target.setPointerCapture(event.pointerId);
  // Stops the drag from selecting page text.
  event.preventDefault();
}

export function clearTrendSelectionOnEscape(event) {
  if (event.key !== "Escape" || !state.trendSelection) {
    return;
  }

  clearTrendSelection();
  hideTooltip();
}

export function moveTrendDrag(event) {
  if (!state.trendDrag) {
    return;
  }

  const x = event.clientX - state.trendDrag.svg.getBoundingClientRect().left;
  if (!state.trendDrag.moved && Math.abs(x - state.trendDrag.startX) < DRAG_THRESHOLD) {
    return;
  }

  state.trendDrag.moved = true;
  state.trendSelection = { from: trendTimeAt(state.trendDrag.startX), to: trendTimeAt(x) };
  drawTrendSelection(state.trendDrag.svg);
  hideTrendPoint();
  if (trendRange()) {
    showSelectionTooltip(event.clientX, event.clientY);
  } else {
    hideTooltip();
  }
}

// Shift-click: with a range, moves whichever edge is nearer time t to it, so
// a click outside stretches the range to reach it and one inside trims it.
// Without one, selects from the last plain click. Returns false when there's
// nothing to select from.
function extendTrendSelection(t) {
  const range = trendRange();
  if (range) {
    if (Math.abs(t - range.a) <= Math.abs(t - range.b)) {
      state.trendSelection = { from: range.b, to: t };
    } else {
      state.trendSelection = { from: range.a, to: t };
    }
  } else if (state.trendAnchor != null) {
    state.trendSelection = { from: state.trendAnchor, to: t };
  } else {
    return false;
  }

  return true;
}

// A plain click clears the selection and marks where a shift-click selects
// from; a shift-click stretches or trims it.
export function endTrendDrag(event) {
  if (!state.trendDrag) {
    return;
  }

  const { svg, moved, shift } = state.trendDrag;
  state.trendDrag = null;
  if (!moved) {
    const t = trendTimeAt(event.clientX - svg.getBoundingClientRect().left);
    if (!shift || !extendTrendSelection(t)) {
      clearTrendSelection();
      state.trendAnchor = t;
      showTrendTooltip(event);
      return;
    }

    drawTrendSelection(svg);
    hideTrendPoint();
    showSelectionTooltip(event.clientX, event.clientY);
  }

  const range = trendRange();
  if (range) {
    let via = "drag";
    if (!moved) {
      via = "shift_click";
    }
    track("trend_select", {
      period: state.selectedPeriod,
      from: trendClockLabel(range.a, false),
      to: trendClockLabel(range.b, true),
      via,
    });
  }
}

// Arrow keys step through scoring plays while the chart has focus.
export function stepTrend(event) {
  const svg = event.target.closest?.(".trend svg");
  const events = trend && visibleEvents();
  if (!svg || !events?.length) {
    return;
  }

  const moves = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
  if (!(event.key in moves)) {
    return;
  }

  event.preventDefault();
  let index = Number(svg.dataset.index ?? -1) + moves[event.key];
  if (svg.dataset.index == null && event.key === "ArrowLeft") {
    index = events.length - 1;
  }
  index = Math.min(Math.max(index, 0), events.length - 1);
  showTrendPoint(svg, index);
}
