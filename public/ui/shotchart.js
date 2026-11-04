// The shot chart: both teams' shots on one court, their captions and
// tooltips, and the scoring trend drawn on the floor.
import { FLOOR_SQUASH, project, projectHalf } from "../lib/court.js";
import { escapeHtml, round1 } from "../lib/format.js";
import { loadPref, savePref } from "../lib/prefs.js";
import { inSelectedPeriod, playerKey, shooters, wholeTeamPicked } from "./filters.js";
import { scoreHeld } from "./flights.js";
import { CENTER_RINGS, COURT_FLOOR, COURT_HOOPS, COURT_LINES, COURT_VIEWBOX, FLOOR_SHADING, floorGrain, pathFrom } from "./floor.js";
import { playByPlay, shotData } from "./games.js";
import { playback, teamById } from "./playback.js";
import { state } from "./state.js";
import { showTooltip } from "./tooltip.js";
import { gameSeconds, teamColor, trendColors, trendSeries } from "./trend.js";
import { showZones, zonesKeyMarkup, zonesMarkup } from "./zones.js";

// Shots by team id for the game on screen, looked up when a mark is hovered.
export const shotsByTeam = new Map();

function shotScoreLabel(shot) {
  if (!shot.made) {
    return "Miss";
  }
  // The play-by-play couldn't be matched to this shot.
  if (!shot.score) {
    return "Made";
  }

  const { away, home } = state.currentGame;
  return `${away.abbreviation} ${shot.score.away} – ${shot.score.home} ${home.abbreviation}`;
}

// Returns true when the pointer is over a shot and its tooltip is showing.
export function showShotTooltip(event) {
  const mark = event.target.closest?.(".shot");
  const shot = mark && shotsByTeam.get(mark.dataset.team)?.[mark.dataset.shot];
  if (!shot) {
    return false;
  }

  showTooltip(`
    <strong>${escapeHtml(shot.player)}</strong>
    <span class="${shot.made ? "made" : "missed"}">${escapeHtml(shotScoreLabel(shot))}</span>
    <span class="muted">${escapeHtml(`${shot.period_label} · ${shot.clock}`)}</span>`, event.clientX, event.clientY);
  return true;
}

// One full court, left to right: the away team shoots at the left basket and
// the home team at the right.
export function renderShotCharts() {
  const { away, home } = state.currentGame;
  const forTeam = (team) => (shotData[team.id] ?? [])
    .filter((s) => inSelectedPeriod(s) && (state.selectedPlayers.size === 0 || state.selectedPlayers.has(playerKey(s))));
  const awayShots = forTeam(away);
  const homeShots = forTeam(home);
  // With players picked, each team's caption names its picked player (or how
  // many, or just the team when its whole roster is picked), and dims if none
  // of its players are picked.
  const rosters = new Map(shooters());
  const captionName = (team) => {
    const roster = rosters.get(team);
    const players = roster.filter((p) => state.selectedPlayers.has(p.id));
    if (state.selectedPlayers.size === 0 || players.length === 0 || wholeTeamPicked(roster)) {
      return team.full_name;
    }
    if (players.length === 1) {
      return players[0].name;
    }
    return `${team.full_name} · ${players.length} players`;
  };
  const inactive = (team) => state.selectedPlayers.size > 0 && !rosters.get(team).some((p) => state.selectedPlayers.has(p.id));
  // The shooter slot names whoever's shot is in the air (see showShooter).
  const caption = (team, shots, side) => `
    <div class="court-team ${side}${inactive(team) ? " inactive" : ""}">
      <span class="key made" data-made-team="${team.id}" style="${madeColorStyle(team)}"></span>
      <strong>${escapeHtml(captionName(team))}</strong>
      <span class="shooter" data-team="${team.id}" data-made-team="${team.id}" style="${madeColorStyle(team)}" aria-live="polite"></span>
      <span class="fg" data-team="${team.id}">${fgLabel(shots.filter((s) => s.made).length, shots.length)}</span>
    </div>`;

  return `
    <figure class="shotchart">
      <figcaption>
        ${caption(away, awayShots, "left")}
        ${caption(home, homeShots, "right")}
      </figcaption>
      <svg viewBox="${COURT_VIEWBOX}" role="img"
        aria-label="${escapeHtml(`Shot chart: ${away.full_name} shooting left, ${home.full_name} shooting right`)}">
        ${COURT_FLOOR}
        ${FLOOR_SHADING}
        <g class="zones-layer">${zonesMarkup([[away, awayShots, "left"], [home, homeShots, "right"]])}</g>
        ${floorGrain(state.currentGame)}
        ${COURT_LINES}
        ${CENTER_RINGS}
        <g class="zone-outline" aria-hidden="true"></g>
        <g class="court-trend" aria-hidden="true">${courtTrendMarkup()}</g>
        ${renderShotHalf(away, awayShots, "left")}
        ${renderShotHalf(home, homeShots, "right")}
        <g class="hoops">${COURT_HOOPS}</g>
        <g class="flights"></g>
      </svg>
      <p class="legend">
        <span class="key made" data-made-team="${away.id}" style="${madeColorStyle(away)}"></span><span class="key made" data-made-team="${home.id}" style="${madeColorStyle(home)}"></span> Made
        <span class="key missed">×</span> Missed
        <span class="zones-key"${showZones ? "" : " hidden"}>${zonesKeyMarkup()}</span>
        <label class="court-trend-toggle">
          <input type="checkbox" id="courtTrendToggle"${showCourtTrend ? " checked" : ""}> Scoring trend on court
        </label>
        <label class="zones-toggle">
          <input type="checkbox" id="zonesToggle"${showZones ? " checked" : ""}> Hot/cold zones
        </label>
      </p>
    </figure>`;
}

// "3-4 (75.0%)"
export function shootingLabel(made, attempts) {
  let pct = "";
  if (attempts > 0) {
    pct = ` (${((made / attempts) * 100).toFixed(1)}%)`;
  }
  return `${made}-${attempts}${pct}`;
}

export function fgLabel(made, attempts) {
  return `FG ${shootingLabel(made, attempts)}`;
}

// Made shots use the team's primary color. Leave --made unset when there's no
// color, since an empty value would block the stylesheet's fallback.
function madeColorStyle(team) {
  if (!team.colors?.primary) {
    return "";
  }
  return `--made: ${escapeHtml(teamColor(team.colors.primary))}`;
}

// Recolors the shot charts for the current theme in place, so
// a playback, and any shot in the air, carries on. Flights already in the
// air keep their color until they land.
export function recolorShotCharts() {
  for (const el of document.querySelectorAll("#shotcharts [data-made-team]")) {
    const primary = teamById(el.dataset.madeTeam)?.colors?.primary;
    if (primary) {
      el.style.setProperty("--made", teamColor(primary));
    }
  }
}

// A team's shots, projected onto its half of the floor: makes as dots, misses
// as ×'s, both squashed to lie flat and drawn smaller toward the far side.
function renderShotHalf(team, shots, side) {
  shotsByTeam.set(String(team.id), shots);
  const marks = shots.map((s, i) => {
    const p = projectHalf(side, s.x, s.y);
    let data = `data-team="${team.id}" data-shot="${i}" data-t="${gameSeconds(s)}"`;
    if (s.play_id != null) {
      data += ` data-play="${s.play_id}"`;
    }
    if (s.made) {
      const r = round1(6 * p.scale);
      return `<ellipse class="shot made" ${data} cx="${p.x}" cy="${p.y}" rx="${r}" ry="${round1(r * FLOOR_SQUASH)}" />`;
    }
    // The position lives on an inner group so the playback pop-in scales the
    // mark about its own center rather than compounding with the transform.
    const transform = `translate(${p.x} ${p.y}) scale(${round1(p.scale * 100) / 100} ${round1(p.scale * FLOOR_SQUASH * 100) / 100})`;
    return `<g class="shot missed" ${data}><g transform="${transform}">
      <circle r="7" fill="transparent" stroke="none" /><path d="M -5 -5 L 5 5 M -5 5 L 5 -5" /></g></g>`;
  }).join("");

  return `<g class="half" data-team="${team.id}" data-made-team="${team.id}" data-side="${side}" style="${madeColorStyle(team)}">${marks}</g>`;
}

// The scoring trend drawn flat on the shot chart floor, as a trial: game time
// runs baseline to baseline, and each team's score runs across the court,
// moving away from the camera as it climbs. During playback the lines grow
// with the playhead. On unless switched off; remembered.
let showCourtTrend = loadPref("courtTrend", true) !== false;

// World y (across the court) for the lowest and highest scores on the axis.
// The near sideline is y = 500.
const COURT_TREND_NEAR = 470;
const COURT_TREND_FAR = 30;

function courtTrendMarkup() {
  if (!showCourtTrend || !playByPlay || !state.currentGame) {
    return "";
  }

  const series = trendSeries();
  if (!series) {
    return "";
  }

  const { t0, t1, start, events, yMin, yMax } = series;
  let tEnd = t1;
  if (playback && playback.playhead < t1) {
    tEnd = playback.playhead;
  }
  const at = (t, score) => project({
    x: ((t - t0) / (t1 - t0)) * 940,
    y: COURT_TREND_NEAR - ((score - yMin) / (yMax - yMin)) * (COURT_TREND_NEAR - COURT_TREND_FAR),
    z: 0,
  });

  const colors = trendColors();
  const held = scoreHeld();
  const shown = events.filter((e) => e.t < tEnd || (e.t === tEnd && !held));
  const lines = ["away", "home"].map((side) => {
    let score = start[side];
    const points = [at(t0, score)];
    for (const e of shown) {
      points.push(at(e.t, score));
      score = e.play.score[side];
      points.push(at(e.t, score));
    }
    const head = at(tEnd, score);
    points.push(head);
    return { side, points, head, score };
  });

  return lines.map(({ side, points, head, score }) => {
    const color = escapeHtml(colors[side]);
    const s = head.scale;
    // The leader's score goes above its line and the trailer's below, so
    // the two don't land on each other when the game is close.
    const other = lines.find((l) => l.side !== side);
    let labelY = head.y - 8 * s;
    if (score < other.score || (score === other.score && side === "away")) {
      labelY = head.y + 20 * s;
    }
    return `
      <path class="court-trend-line" d="${pathFrom(points)}" stroke="${color}" />
      <ellipse class="court-trend-head" cx="${head.x}" cy="${head.y}" rx="${round1(6 * s)}" ry="${round1(6 * s * FLOOR_SQUASH)}" fill="${color}" />
      <text class="court-trend-score" x="${round1(head.x - 8 * s)}" y="${round1(labelY)}"
        font-size="${round1(16 * s)}" stroke-width="${round1(1.6 * s)}" text-anchor="end" fill="${color}">${score}</text>`;
  }).join("");
}

export function drawCourtTrend() {
  const layer = document.querySelector("#shotcharts .court-trend");
  if (layer) {
    layer.innerHTML = courtTrendMarkup();
  }
}

export function toggleCourtTrend(event) {
  if (event.target.id !== "courtTrendToggle") {
    return;
  }

  showCourtTrend = event.target.checked;
  savePref("courtTrend", showCourtTrend);
  track("court_trend_toggle", { on: showCourtTrend });
  drawCourtTrend();
}
