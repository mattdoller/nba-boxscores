// The scoreboard, line score, and each team's sortable box score.
import { escapeHtml } from "../lib/format.js";
import { loadPref, savePref } from "../lib/prefs.js";
import { minutes, sortPlayers } from "../lib/stats.js";
import { boxscoreEl } from "./dom.js";
import { renderPeriodTabs } from "./filters.js";
import { testDataNotice } from "./games.js";
import { pbpCollapsed } from "./pbp.js";
import { PLAY_LABELS, playbackRate, speedLabel } from "./playback.js";
import { state } from "./state.js";
import { teamColor } from "./trend.js";

const STAT_COLUMNS = [
  ["min", "MIN"], ["pts", "PTS"], ["reb", "REB"], ["ast", "AST"],
  ["stl", "STL"], ["blk", "BLK"], ["turnover", "TO"], ["pf", "PF"],
  ["fg", "FG"], ["fg3", "3PT"], ["ft", "FT"], ["plus_minus", "+/-"],
];

// Keeps the quarter bar pinned just below the scoreboard, whatever its height.
const scoreboardObserver = new ResizeObserver(([entry]) => {
  boxscoreEl.style.setProperty("--scoreboard-height", `${entry.target.offsetHeight}px`);
});

export function trackScoreboardHeight() {
  scoreboardObserver.disconnect();
  scoreboardObserver.observe(boxscoreEl.querySelector(".scoreboard"));
}

// Phrases kept on one line; a narrow scoreboard wraps only between them.
function phrases(...parts) {
  return parts.filter(Boolean).map((p) => `<span class="phrase">${escapeHtml(p)}</span>`).join(" ");
}

// The scoreboard's game details, one line each: date and status, then
// "TD Garden, Boston, MA" and "Attendance 19,156 (sellout)" when known.
// Games abroad name the country instead of a state.
function gameDetailLines(game) {
  const date = new Date(`${game.date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
  });
  let tag = "";
  if (game.postseason) {
    tag = ' <span class="tag">Playoffs</span>';
  }
  const lines = [`${phrases(`${date} ·`, game.status)}${tag}`];

  const { venue } = game;
  if (venue) {
    let region = venue.state;
    if (venue.country && venue.country !== "US") {
      region = venue.country;
    }
    let name = venue.name;
    if (venue.city || region) {
      name += ",";
    }
    lines.push(phrases(name, [venue.city, region].filter(Boolean).join(", ")));
  }
  if (game.attendance) {
    let sellout = "";
    if (game.sellout) {
      sellout = "(sellout)";
    }
    lines.push(phrases(`Attendance ${game.attendance.toLocaleString()}`, sellout));
  }
  return lines;
}

export function renderBoxScore(game, stats) {
  state.currentGame = game;
  const { home, away } = game;

  currentStats = stats;
  statSorts.clear();
  const sorts = savedSorts();
  for (const [side, team] of [["away", away], ["home", home]]) {
    if (sorts[side]) {
      statSorts.set(team.id, sorts[side]);
    }
  }
  const players = renderTeamStats(away, stats) + renderTeamStats(home, stats);

  return `
    ${testDataNotice()}
    <header class="scoreboard">
      <div class="team ${away.score > home.score ? "winner" : ""}">
        <span class="abbr">${escapeHtml(away.abbreviation)}</span>
        <span class="name">${escapeHtml(away.full_name)}</span>
        <span class="score" data-team="${away.id}" style="${scoreColorStyle(away)}">${escapeHtml(away.score)}</span>
      </div>
      <div class="at">@</div>
      <div class="team ${home.score > away.score ? "winner" : ""}">
        <span class="abbr">${escapeHtml(home.abbreviation)}</span>
        <span class="name">${escapeHtml(home.full_name)}</span>
        <span class="score" data-team="${home.id}" style="${scoreColorStyle(home)}">${escapeHtml(home.score)}</span>
      </div>
      <p class="meta">
        ${gameDetailLines(game).map((line) => `<span>${line}</span>`).join("")}
      </p>
      ${renderLineScore(game)}
    </header>
    <div class="game-detail">
      <div class="period-bar">
        <span>Quarter</span>
        <div class="period-tabs" id="periodTabs" title="Left and right arrow keys step through quarters">${renderPeriodTabs()}</div>
        <button type="button" id="playButton" class="play-button" title="Play or pause (Space)" disabled>${PLAY_LABELS.play}</button>
        <button type="button" id="speedButton" class="speed-button" title="Playback speed"
          aria-label="Playback speed ${speedLabel(playbackRate)}">${speedLabel(playbackRate)}</button>
        <span id="playClock" class="play-clock" aria-live="off"></span>
        <div class="player-filter">
          <span>Players</span>
          <button type="button" id="playerButton" class="player-button" aria-haspopup="true" aria-expanded="false"
            aria-controls="playerMenu" disabled>All players</button>
          <div id="playerMenu" class="player-menu" hidden></div>
        </div>
      </div>
      <details class="game-section collapsible" id="shotchartsSection" data-section="shotcharts"${openAttr("shotcharts")}>
        <summary><h2>Shot chart and play-by-play</h2></summary>
        <div class="shot-layout${pbpCollapsed ? " pbp-collapsed" : ""}" id="shotLayout">
          <div id="shotcharts" class="shotcharts"><p class="hint">Loading shot charts…</p></div>
          <aside class="pbp-panel">
            <button type="button" id="pbpToggle" class="pbp-toggle" aria-expanded="${!pbpCollapsed}" aria-controls="playbyplay"
              title="${pbpCollapsed ? "Show" : "Hide"} the play-by-play">
              <span class="pbp-toggle-label">Play-by-play</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
            </button>
            <div id="playbyplay" class="pbp-scroll"${pbpCollapsed ? " hidden" : ""}><p class="hint">Loading play-by-play…</p></div>
          </aside>
        </div>
      </details>
      ${players}
      <details class="game-section collapsible" data-section="scoretrend"${openAttr("scoretrend")}>
        <summary><h2>Scoring runs</h2></summary>
        <div id="scoretrend" class="scoretrend"><p class="hint">Loading scoring runs…</p></div>
      </details>
    </div>
  `;
}

// A final score's fill (the team's primary color) and outline (its
// secondary), adjusted for the theme like the charts' team colors. Without
// colors the stylesheet's defaults apply.
function scoreColorStyle(team) {
  const { primary, secondary } = team.colors ?? {};
  if (!primary || !secondary) {
    return "";
  }

  return `--team-primary: ${escapeHtml(teamColor(primary))}; --team-secondary: ${escapeHtml(teamColor(secondary))}`;
}

// Recolors the final scores for the current theme.
export function applyScoreColors() {
  for (const team of [state.currentGame.away, state.currentGame.home]) {
    boxscoreEl.querySelector(`.scoreboard .score[data-team="${team.id}"]`)?.setAttribute("style", scoreColorStyle(team));
  }
}

function renderLineScore(game) {
  const periods = game.home.periods.length >= game.away.periods.length
    ? game.home.periods
    : game.away.periods;
  if (periods.length === 0) {
    return "";
  }

  const row = (team) => `
    <tr>
      <th>${escapeHtml(team.abbreviation)}</th>
      ${periods.map((_, i) => `<td>${escapeHtml(team.periods[i]?.score)}</td>`).join("")}
      <td class="total">${escapeHtml(team.score)}</td>
    </tr>`;

  return `
    <table class="linescore">
      <thead>
        <tr><th></th>${periods.map((p) => `<th>${escapeHtml(p.label)}</th>`).join("")}<th>T</th></tr>
      </thead>
      <tbody>
        ${row(game.away)}
        ${row(game.home)}
      </tbody>
    </table>`;
}

function sortedPlayers(teamId) {
  return sortPlayers(currentStats, teamId, statSorts.get(teamId) ?? DEFAULT_SORT);
}

// The players in the game on screen, and each team's sort: team id -> { key, dir }.
export let currentStats = [];
const statSorts = new Map();
const DEFAULT_SORT = { key: "min", dir: "desc" };

// "away" or "home": settings like sorts are remembered by side, not by team.
function teamSide(teamId) {
  if (Number(teamId) === Number(state.currentGame.away.id)) {
    return "away";
  }
  return "home";
}

// The remembered sorts, { away, home }, keeping only ones still valid.
function savedSorts() {
  const keys = new Set(["player", ...STAT_COLUMNS.map(([key]) => key)]);
  const saved = loadPref("sorts", {});
  const sorts = {};
  for (const side of ["away", "home"]) {
    const sort = saved?.[side];
    if (sort && keys.has(sort.key) && (sort.dir === "asc" || sort.dir === "desc")) {
      sorts[side] = { key: sort.key, dir: sort.dir };
    }
  }
  return sorts;
}

// Sections open unless they were last folded: " open" or "".
function openAttr(section) {
  if (loadPref("sections", {})?.[section] === false) {
    return "";
  }
  return " open";
}

// Remembers a section being folded or opened. Details fire toggle when
// rendered open too, which just records what's already there.
export function rememberSection(event) {
  const details = event.target;
  if (!details.matches?.("details.collapsible[data-section]")) {
    return;
  }

  savePref("sections", { ...loadPref("sections", {}), [details.dataset.section]: details.open });
}

// A player's name, as a button that opens their card when the server sent
// their id.
function playerName(r) {
  const name = escapeHtml(`${r.first_name} ${r.last_name}`);
  if (r.player_id == null) {
    return name;
  }
  return `<button type="button" class="player-link" data-player="${r.player_id}">${name}</button>`;
}

function renderPlayerRows(teamId) {
  return sortedPlayers(teamId).map((r) => `
    <tr>
      <th>${playerName(r)}
        <span class="pos">${escapeHtml(r.position)}</span></th>
      ${STAT_COLUMNS.map(([key]) => `<td>${escapeHtml(cell(r, key))}</td>`).join("")}
    </tr>`).join("");
}

function renderStatHeaders(teamId) {
  const { key: sortKey, dir } = statSorts.get(teamId) ?? DEFAULT_SORT;
  return [["player", "Player"], ...STAT_COLUMNS].map(([key, label]) => {
    let ariaSort = "none";
    if (key === sortKey) {
      ariaSort = dir === "asc" ? "ascending" : "descending";
    }
    return `<th aria-sort="${ariaSort}"><button type="button" class="sort" data-sort="${key}">${label}</button></th>`;
  }).join("");
}

// Clicking a header sorts that team's table by it; clicking again reverses.
// Numbers start high-to-low, names A–Z.
export function sortStats(event) {
  const button = event.target.closest(".stats .sort");
  if (!button) {
    return;
  }

  const table = button.closest("table");
  const teamId = Number(table.dataset.team);
  const key = button.dataset.sort;
  const current = statSorts.get(teamId) ?? DEFAULT_SORT;
  let dir = key === "player" ? "asc" : "desc";
  if (current.key === key) {
    dir = current.dir === "asc" ? "desc" : "asc";
  }
  statSorts.set(teamId, { key, dir });
  savePref("sorts", { ...savedSorts(), [teamSide(teamId)]: { key, dir } });
  track("box_score_sort", { team_id: teamId, key, dir });

  table.querySelector("thead tr").innerHTML = renderStatHeaders(teamId);
  table.querySelector("tbody").innerHTML = renderPlayerRows(teamId);
  table.querySelector(`.sort[data-sort="${key}"]`).focus();
}

function cell(row, key) {
  if (key === "fg" || key === "fg3" || key === "ft") {
    return `${row[`${key}m`] ?? 0}-${row[`${key}a`] ?? 0}`;
  }
  if (key === "plus_minus" && row.plus_minus > 0) {
    return `+${row.plus_minus}`;
  }
  return row[key] ?? "";
}

function renderTeamStats(team, stats) {
  const played = sortedPlayers(team.id);
  const roster = stats.filter((s) => s.team_id === team.id);
  const dnp = roster.filter((s) => s.recorded && minutes(s) === 0);
  // Some older games are missing stats for some players, or the whole team.
  const unrecorded = roster.filter((s) => !s.recorded);
  const unrecordedNote = unrecorded.length && played.length
    ? `<p class="dnp">No stats recorded: ${unrecorded.map((r) => escapeHtml(r.last_name)).join(", ")}</p>`
    : "";

  if (played.length === 0) {
    return `
    <details class="team-stats collapsible" data-team="${team.id}" data-section="${teamSide(team.id)}-stats"${openAttr(`${teamSide(team.id)}-stats`)}>
      <summary><h2>${escapeHtml(team.full_name)}</h2></summary>
      <p class="notice-muted">No player stats were recorded for this game.</p>
    </details>`;
  }

  const totals = { min: "" };
  for (const key of ["pts", "reb", "ast", "stl", "blk", "turnover", "pf",
    "fgm", "fga", "fg3m", "fg3a", "ftm", "fta"]) {
    totals[key] = played.reduce((sum, r) => sum + (r[key] || 0), 0);
  }

  const dnpNote = dnp.length
    ? `<p class="dnp">Did not play: ${dnp.map((r) => escapeHtml(r.last_name)).join(", ")}</p>`
    : "";

  return `
    <details class="team-stats collapsible" data-team="${team.id}" data-section="${teamSide(team.id)}-stats"${openAttr(`${teamSide(team.id)}-stats`)}>
      <summary><h2>${escapeHtml(team.full_name)}</h2></summary>
      <div class="table-wrap">
        <table class="stats" data-team="${team.id}">
          <thead>
            <tr>${renderStatHeaders(team.id)}</tr>
          </thead>
          <tbody>${renderPlayerRows(team.id)}</tbody>
          <tfoot>
            <tr>
              <th>Totals</th>
              ${STAT_COLUMNS.map(([key]) => `<td>${key === "plus_minus" ? "" : cell(totals, key)}</td>`).join("")}
            </tr>
          </tfoot>
        </table>
      </div>
      ${dnpNote}
      ${unrecordedNote}
    </details>`;
}
