// Picking a game: the team, season, and calendar in the control panel, and
// loading the chosen game's box score, shots, and plays.
import { currentSeason, escapeHtml } from "../lib/format.js";
import { getJson, setStatus } from "./api.js";
import { renderBoxScore, trackScoreboardHeight } from "./boxscore.js";
import { renderBigPlays } from "./bigplays.js";
import { applyCardSorts } from "./cardsort.js";
import { boxscoreEl, calendarHint, seasonSelect, teamSelect } from "./dom.js";
import { fillPlayerMenu, refreshPeriodTabs } from "./filters.js";
import { writeHash } from "./hash.js";
import { renderLineups } from "./lineups.js";
import { renderPlayByPlay } from "./pbp.js";
import { stopPlayback } from "./playback.js";
import { renderShotCharts, shotsByTeam } from "./shotchart.js";
import { state } from "./state.js";
import { drawScoreTrend, trendObserver } from "./trend.js";
import { loadLeagueZones, showZones } from "./zones.js";

// Game ids for the selected team and season, keyed by date.
export let gameIdsByDate = new Map();

// Bumped on each load so late responses for an earlier selection are dropped.
export let loadToken = 0;
let gamesToken = 0;

// The date of the game on screen, or null.
export let currentDate = null;

// flatpickr's month dropdown and year spinner are replaced with a plain
// "October – 2024" label; its arrows do the moving, kept within the season.
function syncMonthLabel(selectedDates, dateStr, instance) {
  let label = instance.monthNav.querySelector(".month-label");
  if (!label) {
    label = document.createElement("span");
    label.className = "month-label";
    label.setAttribute("aria-live", "polite");
    instance.monthNav.querySelector(".flatpickr-current-month").append(label);
  }
  label.textContent = `${instance.l10n.months.longhand[instance.currentMonth]} – ${instance.currentYear}`;
}

export const calendar = flatpickr("#calendar", {
  inline: true,
  enable: [],
  onReady: syncMonthLabel,
  onMonthChange: syncMonthLabel,
  onYearChange: syncMonthLabel,
  onChange: ([date]) => {
    if (date) {
      const iso = flatpickr.formatDate(date, "Y-m-d");
      track("date_select", { date: iso, game_id: gameIdsByDate.get(iso) });
      loadBoxScore(iso);
    }
  },
});

// Whether the server is running on the fake games from bin/load-fixtures;
// every game then carries a notice that its data is made up.
let testData = false;

export async function loadInfo() {
  try {
    const info = await getJson("/api/info");
    testData = info.fixtures === true;
    if (Array.isArray(info.seasons) && info.seasons.length > 0) {
      limitSeasons(info.seasons);
    }
  } catch {
    // An older server without /api/info only serves real data.
  }
}

export function testDataNotice() {
  if (!testData) {
    return "";
  }

  return `
    <p class="test-data-notice" role="note">
      <strong>Test data.</strong> The teams are real, but every player, game, and stat here is made up.
    </p>`;
}

export async function loadTeams() {
  try {
    const teams = await getJson("/api/teams");
    teams.sort((a, b) => a.full_name.localeCompare(b.full_name));
    teamSelect.innerHTML = '<option value="">Choose a team…</option>' + teams
      .map((t) => `<option value="${t.id}" data-abbr="${escapeHtml(t.abbreviation)}">${escapeHtml(t.full_name)}</option>`)
      .join("");
    teamSelect.disabled = false;
  } catch (err) {
    teamSelect.innerHTML = '<option value="">Couldn’t load teams</option>';
    setStatus(err.message, true);
  }
}

function seasonOption(year) {
  return `<option value="${year}">${year}–${String(year + 1).slice(2)}</option>`;
}

export function loadSeasons() {
  const latest = currentSeason();
  const options = [];
  for (let year = latest; year >= 1979; year--) {
    options.push(seasonOption(year));
  }
  seasonSelect.innerHTML = options.join("");
}

// An offline server (test data, or bin/server --offline) can only show the
// seasons it has games for, so the menu lists just those, newest first.
function limitSeasons(seasons) {
  seasonSelect.innerHTML = seasons.map(seasonOption).join("");
}

// Limits the calendar's months to the season: its first and last games once
// they're known, otherwise October through June.
function setCalendarRange(first, last) {
  const season = Number(seasonSelect.value);
  calendar.set("minDate", first ?? `${season}-10-01`);
  calendar.set("maxDate", last ?? `${season + 1}-06-30`);
  if (!first) {
    jumpCalendar(`${season}-10-01`);
  }
}

// jumpToDate doesn't fire onMonthChange, so refresh the label by hand.
export function jumpCalendar(date) {
  calendar.jumpToDate(date);
  syncMonthLabel(calendar.selectedDates, "", calendar);
}

export async function loadGames() {
  const token = ++gamesToken;
  const teamId = teamSelect.value;
  // Also invalidates any box score still loading for the previous selection.
  loadToken++;
  currentDate = null;
  writeHash();
  calendar.clear();
  calendar.set("enable", []);
  setCalendarRange();
  gameIdsByDate = new Map();
  boxscoreEl.innerHTML = "";
  if (!teamId) {
    calendarHint.textContent = "Choose a team to see the dates it played.";
    return;
  }

  calendarHint.textContent = "Loading games…";
  setStatus("");
  try {
    const games = await getJson(`/api/games?team_id=${teamId}&season=${seasonSelect.value}`);
    if (token !== gamesToken) {
      return;
    }

    if (games.length === 0) {
      calendarHint.textContent = "No completed games this season.";
      return;
    }
    gameIdsByDate = new Map(games.map((g) => [g.date, g.id]));
    const dates = games.map((g) => g.date);
    calendar.set("enable", dates);
    setCalendarRange(dates[0], dates[dates.length - 1]);
    jumpCalendar(dates[dates.length - 1]);
    calendarHint.textContent = `${games.length} games played. Pick a highlighted date.`;
  } catch (err) {
    if (token === gamesToken) {
      track("load_error", { section: "games", team_id: teamId, season: seasonSelect.value, message: err.message });
      calendarHint.textContent = "";
      setStatus(err.message, true);
    }
  }
}

export async function loadBoxScore(date, period = "all", players = []) {
  const token = ++loadToken;
  const gameId = gameIdsByDate.get(date);
  currentDate = date;
  stopPlayback();
  shotsByTeam.clear();
  shotData = null;
  state.leagueZones = null;
  playByPlay = null;
  state.selectedPeriod = period;
  state.selectedPlayers = new Set(players);
  writeHash();
  setStatus("Loading box score…");
  boxscoreEl.innerHTML = "";
  try {
    const { game, stats } = await getJson(`/api/boxscore?game_id=${gameId}&date=${date}`);
    if (token !== loadToken) {
      return;
    }

    setStatus("");
    boxscoreEl.innerHTML = renderBoxScore(game, stats);
    track("game_view", {
      game_id: game.id,
      date: game.date,
      away: game.away.abbreviation,
      home: game.home.abbreviation,
      period: state.selectedPeriod,
      players: [...state.selectedPlayers],
    });
    trackScoreboardHeight();
    trendObserver.disconnect();
    trendObserver.observe(document.getElementById("scoretrend"));
  } catch (err) {
    if (token === loadToken) {
      setStatus(err.message, true);
      track("load_error", { section: "boxscore", game_id: gameId, message: err.message });
    }
    return;
  }

  // Load these after the box score so a slow or failed request doesn't hold it up.
  loadSection("shotcharts", `/api/shotchart?game_id=${gameId}`, token, (shots) => {
    shotData = shots;
    refreshPeriodTabs();
    fillPlayerMenu();
    document.getElementById("playButton").disabled = false;
    if (showZones) {
      loadLeagueZones();
    }
    return renderShotCharts();
  });
  loadSection("playbyplay", `/api/playbyplay?game_id=${gameId}`, token, (plays) => {
    playByPlay = plays;
    refreshPeriodTabs();
    drawScoreTrend();
    document.getElementById("bigplays").innerHTML = renderBigPlays();
    return renderPlayByPlay();
  }, ["scoretrend", "bigplays"]);
  loadSection("lineups", `/api/lineups?game_id=${gameId}`, token, renderLineups);
}

// Renders a section from a request; on failure the error goes in it and in
// any other sections (errorIds) that depend on the same data.
async function loadSection(id, url, token, render, errorIds = []) {
  const el = document.getElementById(id);
  try {
    const data = await getJson(url);
    if (token === loadToken) {
      el.innerHTML = render(data);
      // Sortable tables in it start in their remembered order.
      applyCardSorts(el);
    }
  } catch (err) {
    if (token === loadToken) {
      track("load_error", { section: id, url, message: err.message });
      for (const target of [id, ...errorIds]) {
        document.getElementById(target).innerHTML = `<p class="notice">${escapeHtml(err.message)}</p>`;
      }
    }
  }
}

// The game's shots and plays once loaded (the game is state.currentGame).
export let shotData = null;
export let playByPlay = null;
