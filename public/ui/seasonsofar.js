// The player card's season so far: the player's season up to the game on
// screen, from the cached games (/api/playerseason). Their averages, a
// trend across their games, and their game log, with the game on screen
// marked and every other one a click away.
import { escapeHtml, round1 } from "../lib/format.js";
import { loadPref, savePref } from "../lib/prefs.js";
import { sortHeader } from "./cardsort.js";
import { percent, seasonLabel } from "./cardzones.js";
import { state } from "./state.js";

// What the trend follows, game by game. Remembered.
const TRENDS = {
  pts: { label: "PTS", value: (g) => g.pts },
  reb: { label: "REB", value: (g) => g.reb },
  ast: { label: "AST", value: (g) => g.ast },
  min: { label: "MIN", value: (g) => g.min },
  fg: { label: "FG%", value: (g) => (g.fga ? (g.fgm / g.fga) * 100 : null), percent: true },
};
let trendStat = loadPref("seasonTrend", "pts");
if (!(trendStat in TRENDS)) {
  trendStat = "pts";
}

// The trend's running average covers this many games.
const ROLLING_GAMES = 5;

function perGame(total, games) {
  return (total / games).toFixed(1);
}

// "33:41" from minutes as a number.
function minutes(value) {
  const seconds = Math.round(value * 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function shortDate(date) {
  return new Date(`${date}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// "2025–26 so far" with the game on screen's date, or the whole season
// without one.
function heading(data) {
  if (data.through) {
    return `${seasonLabel(data.season)} through ${shortDate(data.through)}`;
  }
  return `${seasonLabel(data.season)} season`;
}

function averages(t) {
  const items = [
    ["GP", t.gp],
    ["MIN", perGame(t.min, t.gp)],
    ["PTS", perGame(t.pts, t.gp)],
    ["REB", perGame(t.reb, t.gp)],
    ["AST", perGame(t.ast, t.gp)],
    ["STL", perGame(t.stl, t.gp)],
    ["BLK", perGame(t.blk, t.gp)],
    ["FG%", percent(t.fgm, t.fga)],
    ["3P%", percent(t.fg3m, t.fg3a)],
    ["FT%", percent(t.ftm, t.fta)],
  ];
  return `<dl class="season-averages">${items.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

// The stat across the player's games as a line, with its running average,
// and the game on screen marked.
function trendChart(games) {
  const width = 640;
  const height = 120;
  const pad = { top: 10, right: 8, bottom: 18, left: 30 };
  const { value, percent: isPercent } = TRENDS[trendStat];
  const values = games.map(value);
  const known = values.filter((v) => v != null);
  const top = Math.max(isPercent ? 100 : 1, ...known);
  const x = (i) => pad.left + (games.length === 1 ? 0 : (i / (games.length - 1)) * (width - pad.left - pad.right));
  const y = (v) => pad.top + (1 - v / top) * (height - pad.top - pad.bottom);
  const path = (points) => points.map(([i, v], n) => `${n === 0 ? "M" : "L"} ${round1(x(i))} ${round1(y(v))}`).join(" ");

  const line = path(values.map((v, i) => [i, v]).filter(([, v]) => v != null));
  const rolling = values.map((_, i) => {
    const recent = values.slice(Math.max(0, i - ROLLING_GAMES + 1), i + 1).filter((v) => v != null);
    return [i, recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null];
  }).filter(([, v]) => v != null);
  const current = games.findIndex((g) => g.game_id === state.currentGame?.id);
  let marker = "";
  if (current !== -1 && values[current] != null) {
    marker = `<circle class="season-trend-current" cx="${round1(x(current))}" cy="${round1(y(values[current]))}" r="4" />`;
  }
  const dots = values.map((v, i) => (v == null ? "" : `<circle class="season-trend-dot" cx="${round1(x(i))}" cy="${round1(y(v))}" r="2"><title>${escapeHtml(shortDate(games[i].date))} ${games[i].home ? "vs" : "@"} ${escapeHtml(games[i].opponent)}: ${round1(v)}${isPercent ? "%" : ""}</title></circle>`)).join("");
  const label = isPercent ? `${Math.round(top)}%` : round1(top);
  return `
    <svg class="season-trend" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(TRENDS[trendStat].label)} by game">
      <line class="season-trend-axis" x1="${pad.left}" y1="${y(0)}" x2="${width - pad.right}" y2="${y(0)}" />
      <text class="season-trend-tick" x="${pad.left - 4}" y="${y(top) + 4}">${label}</text>
      <text class="season-trend-tick" x="${pad.left - 4}" y="${y(0) + 4}">0</text>
      <path class="season-trend-line" d="${line}" />
      <path class="season-trend-rolling" d="${path(rolling)}" />
      ${dots}
      ${marker}
      <text class="season-trend-end" x="${pad.left}" y="${height - 4}">${escapeHtml(shortDate(games[0].date))}</text>
      <text class="season-trend-end end" x="${width - pad.right}" y="${height - 4}">${escapeHtml(shortDate(games.at(-1).date))}</text>
    </svg>`;
}

function gameLog(games) {
  const rows = [...games].reverse().map((g) => `
    <tr data-game-date="${g.date}" data-team="${escapeHtml(g.team ?? "")}" class="${g.game_id === state.currentGame?.id ? "current" : ""}" title="Open this game">
      <th data-value="${g.date}">${escapeHtml(shortDate(g.date))}</th>
      <td class="text">${g.home ? "vs" : "@"} ${escapeHtml(g.opponent)}</td>
      <td class="text" data-value="${g.team_pts - g.opp_pts}">${g.result} ${g.team_pts}–${g.opp_pts}</td>
      <td data-value="${g.min}">${minutes(g.min)}</td>
      <td>${g.pts}</td>
      <td>${g.reb}</td>
      <td>${g.ast}</td>
      <td data-value="${g.fgm}">${g.fgm}-${g.fga}</td>
      <td data-value="${g.fg3m}">${g.fg3m}-${g.fg3a}</td>
      <td data-value="${g.ftm}">${g.ftm}-${g.fta}</td>
      <td>${g.plus_minus > 0 ? "+" : ""}${g.plus_minus}</td>
    </tr>`).join("");
  return `
    <div class="table-wrap season-games">
      <table class="stats season-game-log" data-sort-table="season-games">
        <thead>
          <tr>${sortHeader("Date")}${sortHeader("Opp", { text: true })}${sortHeader("Result", { text: true, descending: true, title: "Sorts by margin" })}${sortHeader("MIN")}${sortHeader("PTS")}${sortHeader("REB")}${sortHeader("AST")}${sortHeader("FG", { title: "Sorts by makes" })}${sortHeader("3PT", { title: "Sorts by makes" })}${sortHeader("FT", { title: "Sorts by makes" })}${sortHeader("+/-")}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// The section, for /api/playerseason's data, null while it loads, or an
// Error. A player with no games in the cache this season gets a note when
// they're in the game on screen (`inGame`), and no section otherwise, like a
// retired player found by name.
export function seasonSoFar(data, inGame = true) {
  if (!data) {
    return '<section class="season-so-far"><h3>Season so far</h3><p class="hint">Loading the season…</p></section>';
  }
  if (data instanceof Error) {
    return `<section class="season-so-far"><h3>Season so far</h3><p class="notice">${escapeHtml(data.message)}</p></section>`;
  }
  if (data.games.length === 0) {
    if (!inGame) {
      return "";
    }
    return `<section class="season-so-far"><h3>${heading(data)}</h3>
      <p class="hint">No games of theirs in the cache yet. Games are added as they're opened; <code>bin/backfill</code> and <code>bin/index</code> fill in a whole season.</p></section>`;
  }

  const trendButtons = Object.entries(TRENDS)
    .map(([key, { label }]) => `<button type="button" data-season-trend="${key}" aria-pressed="${key === trendStat}">${label}</button>`)
    .join("");
  return `
    <section class="season-so-far">
      <div class="card-section-head">
        <h3>${heading(data)}</h3>
        <div class="segmented" role="group" aria-label="Trend">${trendButtons}</div>
      </div>
      ${averages(data.totals)}
      ${trendChart(data.games)}
      ${gameLog(data.games)}
      <p class="hint">From the ${data.games.length} of their games in the cache (${data.league_games} league games in all by then). The line is each game; the lighter one, their last ${ROLLING_GAMES}. Click a game to open it.</p>
    </section>`;
}

// Switches the trend's stat. Returns true when the click was on one.
export function seasonTrendClick(event) {
  const button = event.target.closest("[data-season-trend]");
  if (!button) {
    return false;
  }

  trendStat = button.dataset.seasonTrend;
  savePref("seasonTrend", trendStat);
  track("season_trend", { stat: trendStat });
  return true;
}
