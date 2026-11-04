import { arcPoints, FLOOR_SQUASH, KEY_AREA, project, projectHalf, THREE_POINT_AREA } from "./lib/court.js";
import { currentSeason, escapeHtml, periodLabel, round1 } from "./lib/format.js";
import { loadPref, savePref } from "./lib/prefs.js";
import { minutes, sortPlayers } from "./lib/stats.js";
import { ZONE_CLIPS, ZONE_LAYERS, ZONE_NAMES, ZONE_LABEL_SPOTS, zoneComparison, zoneTotals } from "./lib/zones.js";

const teamSelect = document.getElementById("teamSelect");
const seasonSelect = document.getElementById("seasonSelect");
const calendarHint = document.getElementById("calendarHint");
const statusEl = document.getElementById("status");
const boxscoreEl = document.getElementById("boxscore");

// Game ids for the selected team and season, keyed by date.
let gameIdsByDate = new Map();

// Bumped on each load so late responses for an earlier selection are dropped.
let loadToken = 0;
let gamesToken = 0;

// The date of the game on screen, or null.
let currentDate = null;

const STAT_COLUMNS = [
  ["min", "MIN"], ["pts", "PTS"], ["reb", "REB"], ["ast", "AST"],
  ["stl", "STL"], ["blk", "BLK"], ["turnover", "TO"], ["pf", "PF"],
  ["fg", "FG"], ["fg3", "3PT"], ["ft", "FT"], ["plus_minus", "+/-"],
];

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

const calendar = flatpickr("#calendar", {
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

// Every API call goes through getJson, so counting the calls in flight here
// drives one loading indicator for all of them.
const apiActivity = document.getElementById("apiActivity");
const apiActivityLabel = apiActivity.querySelector(".api-activity-label");
let requestsInFlight = 0;

function trackRequests(change) {
  requestsInFlight += change;
  const active = requestsInFlight > 0;
  apiActivity.classList.toggle("active", active);
  // The label only has text while active, so screen readers announce it once
  // per burst of requests rather than reading a hidden "Loading…".
  apiActivityLabel.textContent = "";
  if (active) {
    apiActivityLabel.textContent = "Loading…";
  }
}

async function getJson(url) {
  trackRequests(1);
  try {
    const res = await fetch(url);
    // A stale server without this route answers with Express's HTML 404 page.
    if (!res.headers.get("content-type")?.includes("application/json")) {
      throw new Error(`Request failed (${res.status}). If the server was started before a code change, restart it.`);
    }
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return body;
  } finally {
    trackRequests(-1);
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

// Whether the server is running on the fake games from bin/load-fixtures;
// every game then carries a notice that its data is made up.
let testData = false;

async function loadInfo() {
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

function testDataNotice() {
  if (!testData) {
    return "";
  }

  return `
    <p class="test-data-notice" role="note">
      <strong>Test data.</strong> The teams are real, but every player, game, and stat here is made up.
    </p>`;
}

async function loadTeams() {
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

function loadSeasons() {
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
function jumpCalendar(date) {
  calendar.jumpToDate(date);
  syncMonthLabel(calendar.selectedDates, "", calendar);
}

async function loadGames() {
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

async function loadBoxScore(date, period = "all", players = []) {
  const token = ++loadToken;
  const gameId = gameIdsByDate.get(date);
  currentDate = date;
  stopPlayback();
  shotsByTeam.clear();
  shotData = null;
  leagueZones = null;
  playByPlay = null;
  selectedPeriod = period;
  selectedPlayers = new Set(players);
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
      period: selectedPeriod,
      players: [...selectedPlayers],
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
    return renderPlayByPlay();
  }, ["scoretrend"]);
}

// Renders a section from a request; on failure the error goes in it and in
// any other sections (errorIds) that depend on the same data.
async function loadSection(id, url, token, render, errorIds = []) {
  const el = document.getElementById(id);
  try {
    const data = await getJson(url);
    if (token === loadToken) {
      el.innerHTML = render(data);
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

// The game currently shown, its shots and plays once loaded, and the quarter
// ("all" or a period number) the shot charts and play-by-play are filtered to.
let currentGame = null;
let shotData = null;
let playByPlay = null;
let selectedPeriod = "all";

// Keeps the quarter bar pinned just below the scoreboard, whatever its height.
const scoreboardObserver = new ResizeObserver(([entry]) => {
  boxscoreEl.style.setProperty("--scoreboard-height", `${entry.target.offsetHeight}px`);
});

function trackScoreboardHeight() {
  scoreboardObserver.disconnect();
  scoreboardObserver.observe(boxscoreEl.querySelector(".scoreboard"));
}

// Every period the game had, from the line score, shots, and plays. The line
// score can be missing, so overtimes may only show up once the others load.
function gamePeriods() {
  const { home, away } = currentGame;
  const seen = [
    ...Object.values(shotData ?? {}).flat(),
    ...(playByPlay ?? []),
  ].map((item) => item.period);
  const count = Math.max(home.periods.length, away.periods.length, 4, ...seen);
  return Array.from({ length: count }, (_, i) => i + 1);
}

function refreshPeriodTabs() {
  const tabs = document.getElementById("periodTabs");
  if (tabs) {
    tabs.innerHTML = renderPeriodTabs();
  }
}

function inSelectedPeriod(item) {
  return selectedPeriod === "all" || item.period === selectedPeriod;
}

function renderPeriodTabs() {
  const options = [["all", "All"], ...gamePeriods().map((p) => [p, periodLabel(p)])];
  return options.map(([value, label]) => `
    <button type="button" data-period="${value}" aria-pressed="${value === selectedPeriod}"
      class="${value === selectedPeriod ? "active" : ""}">${escapeHtml(label)}</button>`)
    .join("");
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

function renderBoxScore(game, stats) {
  currentGame = game;
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
function applyScoreColors() {
  for (const team of [currentGame.away, currentGame.home]) {
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
let currentStats = [];
const statSorts = new Map();
const DEFAULT_SORT = { key: "min", dir: "desc" };

// "away" or "home": settings like sorts are remembered by side, not by team.
function teamSide(teamId) {
  if (Number(teamId) === Number(currentGame.away.id)) {
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
function rememberSection(event) {
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
function sortStats(event) {
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

// One half's floor markings, in hoop coordinates.
const HALF_COURT_LINES = [
  { points: [[-250, -47.5], [250, -47.5], [250, 422.5], [-250, 422.5], [-250, -47.5]] },
  { points: [[-80, -47.5], [-80, 142.5], [80, 142.5], [80, -47.5]] },
  { points: [[-60, -47.5], [-60, 142.5], [60, 142.5], [60, -47.5]] },
  { points: arcPoints(0, 142.5, 60, 0, 180) },
  { points: arcPoints(0, 142.5, 60, 180, 360), dashed: true, onKey: true },
  { points: arcPoints(0, 0, 40, 0, 180), onKey: true },
  { points: [[-220, -47.5], [-220, 89.5], ...arcPoints(0, 0, 237.5, 157.9, 22.1, 48), [220, 89.5], [220, -47.5]], kind: "three-point-line" },
  // Also the top of the key above; drawn again on its own so it can be thicker.
  { points: [[-80, 142.5], [80, 142.5]], kind: "free-throw-line" },
];

// The rim is 10 ft up; the backboard spans 9–12.5 ft, 6 ft wide, 4 ft in from
// the baseline, held up by a stanchion behind the baseline.
const RIM_HEIGHT = 100;
const RIM_RADIUS = 7.5;

function pathFrom(points) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

function renderHoop(side) {
  const at = (hx, hy, z) => projectHalf(side, hx, hy, z);
  const board = [at(-30, -7.5, 90), at(30, -7.5, 90), at(30, -7.5, 125), at(-30, -7.5, 125)];
  const rim = arcPoints(0, 0, RIM_RADIUS, 0, 360, 24).map(([hx, hy]) => at(hx, hy, RIM_HEIGHT));
  const stanchion = [at(0, -67.5, 0), at(0, -67.5, 115), at(0, -7.5, 115)];
  return `
    <path class="stanchion" d="${pathFrom(stanchion)}" />
    <path class="backboard" d="${pathFrom(board)} Z" />
    <path class="rim" d="${pathFrom(rim)} Z" />`;
}

const COURT_CORNERS = [[0, 0], [940, 0], [940, 500], [0, 500]].map(([x, y]) => project({ x, y, z: 0 }));

// The floor and its markings never change, so they're built once.
const COURT_FLOOR = `<path class="court-floor" d="${pathFrom(COURT_CORNERS)} Z" />`;

const COURT_LINES = `
  ${["left", "right"].flatMap((side) => HALF_COURT_LINES.map(({ points, dashed, onKey, kind }) => `
    <path class="court-line${dashed ? " dashed" : ""}${onKey ? " on-key" : ""}${kind ? ` ${kind}` : ""}" data-side="${side}"
      d="${pathFrom(points.map(([hx, hy]) => projectHalf(side, hx, hy)))}" />`)).join("")}`;

const COURT_HOOPS = renderHoop("left") + renderHoop("right");

// A circle at center court, on the floor.
function centerCircle(r) {
  return `${pathFrom(arcPoints(470, 250, r, 0, 360, 64).map(([x, y]) => project({ x, y, z: 0 })))} Z`;
}

function floorArea(points) {
  return ["left", "right"]
    .map((side) => `${pathFrom(points.map(([hx, hy]) => projectHalf(side, hx, hy)))} Z`)
    .join(" ");
}

// Light gray shading inside both three-point lines, a little darker in the
// keys and the center disk (its inner circle left white). Court lines go over it.
const FLOOR_SHADING = `
  <path class="three-point-area" d="${floorArea(THREE_POINT_AREA)}" />
  <path class="key-area" d="${floorArea(KEY_AREA)}" />
  <path class="center-disk" d="${centerCircle(60)}" />
  <path class="center-inner" d="${centerCircle(20)}" />`;

const CENTER_RINGS = `
  <path class="center-ring" d="${centerCircle(60)}" />
  <path class="center-ring" d="${centerCircle(20)}" />`;

// A straight line on the floor, in world coordinates.
function floorSegment(x1, y1, x2, y2) {
  const a = project({ x: x1, y: y1, z: 0 });
  const b = project({ x: x2, y: y2, z: 0 });
  return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
}

// Floorboards run the length of the court. Real ones are about 2¼" wide;
// these are a foot wide so they don't blur together at chart size. Each
// row's board ends are staggered from its neighbors' by cycling through
// these lengths from a different starting point.
const PLANK_WIDTH = 10;
const PLANK_LENGTHS = [40, 55, 30, 50, 65, 35, 45];

const WOOD_FLOOR = (() => {
  const d = [];
  for (let y = PLANK_WIDTH; y < 500; y += PLANK_WIDTH) {
    d.push(floorSegment(0, y, 940, y));
  }
  for (let row = 0; row < 500 / PLANK_WIDTH; row++) {
    const y = row * PLANK_WIDTH;
    let i = (row * 3) % PLANK_LENGTHS.length;
    for (let x = 5 + ((row * 23) % 40); x < 940; x += PLANK_LENGTHS[i++ % PLANK_LENGTHS.length]) {
      d.push(floorSegment(x, y, x, y + PLANK_WIDTH));
    }
  }
  return `<path class="floorboards" d="${d.join(" ")}" />`;
})();

// The Celtics' parquet: squares of boards, about 5 ft on a side, each
// square's boards turned a quarter turn from its neighbors'.
const PARQUET_COLUMNS = 20;
const PARQUET_ROWS = 10;
const PARQUET_BOARDS = 5;

const PARQUET_FLOOR = (() => {
  const w = 940 / PARQUET_COLUMNS;
  const h = 500 / PARQUET_ROWS;
  const squares = [];
  const boards = [];
  for (let c = 1; c < PARQUET_COLUMNS; c++) {
    squares.push(floorSegment(c * w, 0, c * w, 500));
  }
  for (let r = 1; r < PARQUET_ROWS; r++) {
    squares.push(floorSegment(0, r * h, 940, r * h));
  }
  for (let c = 0; c < PARQUET_COLUMNS; c++) {
    for (let r = 0; r < PARQUET_ROWS; r++) {
      const x = c * w;
      const y = r * h;
      for (let b = 1; b < PARQUET_BOARDS; b++) {
        if ((c + r) % 2 === 0) {
          boards.push(floorSegment(x, y + (b * h) / PARQUET_BOARDS, x + w, y + (b * h) / PARQUET_BOARDS));
        } else {
          boards.push(floorSegment(x + (b * w) / PARQUET_BOARDS, y, x + (b * w) / PARQUET_BOARDS, y + h));
        }
      }
    }
  }
  return `
    <path class="floorboards" d="${boards.join(" ")}" />
    <path class="floorboards parquet-squares" d="${squares.join(" ")}" />`;
})();

// Every floor is wood but the Celtics' parquet in Boston. Games without a
// venue go by the home team.
function floorGrain(game) {
  if (game.venue) {
    if (/\b(TD|Boston) Garden\b/i.test(game.venue.name)) {
      return PARQUET_FLOOR;
    }
    return WOOD_FLOOR;
  }
  if (game.home.abbreviation === "BOS") {
    return PARQUET_FLOOR;
  }
  return WOOD_FLOOR;
}

// Fits the floor and both backboards, with a little room for flights above.
const COURT_VIEWBOX = (() => {
  const points = [...COURT_CORNERS, ...["left", "right"].map((side) => projectHalf(side, 0, -7.5, 200))];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = 12;
  const left = Math.min(...xs) - pad;
  const top = Math.min(...ys) - pad;
  return `${round1(left)} ${round1(top)} ${round1(Math.max(...xs) + pad - left)} ${round1(Math.max(...ys) + pad - top)}`;
})();

// Shots by team id for the game on screen, looked up when a mark is hovered.
const shotsByTeam = new Map();

// One tooltip shared by the shot charts and the scoring trend.
const tooltip = document.createElement("div");
tooltip.className = "tooltip";
tooltip.hidden = true;
document.body.append(tooltip);

// Shows the tooltip above and to the right of (x, y), flipping inward near the viewport edges.
function showTooltip(html, x, y) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const { offsetWidth: w, offsetHeight: h } = tooltip;
  let left = x + 12;
  if (left + w > window.innerWidth - 8) {
    left = x - w - 12;
  }
  let top = y - h - 12;
  if (top < 8) {
    top = y + 12;
  }
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function shotScoreLabel(shot) {
  if (!shot.made) {
    return "Miss";
  }
  // The play-by-play couldn't be matched to this shot.
  if (!shot.score) {
    return "Made";
  }

  const { away, home } = currentGame;
  return `${away.abbreviation} ${shot.score.away} – ${shot.score.home} ${home.abbreviation}`;
}

// Returns true when the pointer is over a shot and its tooltip is showing.
function showShotTooltip(event) {
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

// The players whose shots the charts are limited to (see playerKey); empty
// means everyone.
let selectedPlayers = new Set();

// Identifies a shooter: their stats.nba.com id, or their name if the server
// didn't send ids (an older server). Always a string, as in the URL.
function playerKey(shot) {
  return String(shot.player_id ?? shot.player);
}

// Everyone who took a shot in the game, by team: [[team, [{ id, name }]], ...].
function shooters() {
  const { away, home } = currentGame;
  return [away, home].map((team) => {
    const players = new Map();
    for (const shot of shotData?.[team.id] ?? []) {
      players.set(playerKey(shot), shot.player);
    }
    const list = [...players].map(([id, name]) => ({ id, name }));
    // By last name, as in the box score.
    const last = (name) => name.split(" ").slice(1).join(" ") || name;
    list.sort((a, b) => last(a.name).localeCompare(last(b.name)));
    return [team, list];
  });
}

// Whether every shooter on a team is picked.
function wholeTeamPicked(players) {
  return players.length > 0 && players.every((p) => selectedPlayers.has(p.id));
}

// "All players", the one picked player's name, a team's name when exactly its
// whole roster is picked, or "3 players".
function playersLabel(players) {
  if (players.length === 0) {
    return "All players";
  }
  if (players.length === 1) {
    return players[0].name;
  }
  const whole = shooters().filter(([, roster]) => wholeTeamPicked(roster));
  const wholeCount = whole.reduce((sum, [, roster]) => sum + roster.length, 0);
  if (wholeCount === players.length) {
    if (whole.length === 1) {
      return whole[0][0].full_name;
    }
    return "All players";
  }
  return `${players.length} players`;
}

function pickedPlayers() {
  return shooters().flatMap(([, players]) => players).filter((p) => selectedPlayers.has(p.id));
}

// Builds the checkbox menu of shooters, grouped by team. Players from the URL
// who didn't shoot in this game are dropped.
function fillPlayerMenu() {
  const groups = shooters();
  const known = new Set(groups.flatMap(([, players]) => players.map((p) => p.id)));
  const kept = new Set([...selectedPlayers].filter((id) => known.has(id)));
  if (kept.size !== selectedPlayers.size) {
    selectedPlayers = kept;
    writeHash();
  }

  document.getElementById("playerMenu").innerHTML = `
    <button type="button" class="show-all">Show all players</button>
    ${groups.map(([team, players]) => `
      <fieldset>
        <legend>
          <label class="team-toggle"><input type="checkbox" data-team-toggle="${team.id}"> ${escapeHtml(team.full_name)}</label>
        </legend>
        ${players.map((p) => `
          <label><input type="checkbox" value="${escapeHtml(p.id)}"${selectedPlayers.has(p.id) ? " checked" : ""}> ${escapeHtml(p.name)}</label>`).join("")}
      </fieldset>`).join("")}`;
  syncTeamToggles();
  updatePlayerButton();
  document.getElementById("playerButton").disabled = false;
}

// Each team's checkbox is checked when all its players are, and
// indeterminate when only some are.
function syncTeamToggles() {
  for (const toggle of document.querySelectorAll("#playerMenu [data-team-toggle]")) {
    const boxes = [...toggle.closest("fieldset").querySelectorAll("input[value]")];
    const checked = boxes.filter((box) => box.checked).length;
    toggle.checked = checked > 0 && checked === boxes.length;
    toggle.indeterminate = checked > 0 && checked < boxes.length;
  }
}

function updatePlayerButton() {
  document.getElementById("playerButton").textContent = playersLabel(pickedPlayers());
}

function setPlayerMenuOpen(open) {
  const menu = document.getElementById("playerMenu");
  const button = document.getElementById("playerButton");
  if (!menu) {
    return;
  }
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}

// Applies a new set of picked players to the charts and the URL.
function setSelectedPlayers(players) {
  selectedPlayers = players;
  stopPlayback();
  hideTooltip();
  writeHash();
  updatePlayerButton();
  document.getElementById("shotcharts").innerHTML = renderShotCharts();
}

// Opens and closes the menu, and handles "Show all".
function playerMenuClick(event) {
  if (event.target.closest("#playerButton")) {
    const open = document.getElementById("playerMenu").hidden;
    track("player_menu", { open });
    setPlayerMenuOpen(open);
    return;
  }
  if (event.target.closest("#playerMenu .show-all")) {
    for (const box of document.querySelectorAll("#playerMenu input")) {
      box.checked = false;
      box.indeterminate = false;
    }
    track("players_select", { players: [], show_all: true });
    setSelectedPlayers(new Set());
  }
}

function playerMenuChange(event) {
  if (!event.target.closest("#playerMenu")) {
    return;
  }

  const teamToggle = event.target.dataset.teamToggle;
  if (teamToggle) {
    for (const box of event.target.closest("fieldset").querySelectorAll("input[value]")) {
      box.checked = event.target.checked;
    }
  }
  syncTeamToggles();

  const checked = [...document.querySelectorAll("#playerMenu input[value]:checked")].map((box) => box.value);
  if (teamToggle) {
    track("players_select", {
      players: checked,
      team_id: Number(teamToggle),
      checked: event.target.checked,
    });
  } else {
    track("players_select", {
      players: checked,
      toggled: event.target.value,
      checked: event.target.checked,
    });
  }
  setSelectedPlayers(new Set(checked));
}

// Clicks outside the menu, or Escape, close it.
function closePlayerMenu(event) {
  const menu = document.getElementById("playerMenu");
  if (!menu || menu.hidden) {
    return;
  }
  if (event.type === "keydown") {
    if (event.key === "Escape") {
      track("player_menu", { open: false, via: "escape" });
      setPlayerMenuOpen(false);
      document.getElementById("playerButton").focus();
    }
    return;
  }
  if (!event.target.closest(".player-filter")) {
    track("player_menu", { open: false, via: "outside_click" });
    setPlayerMenuOpen(false);
  }
}

// One full court, left to right: the away team shoots at the left basket and
// the home team at the right.
function renderShotCharts() {
  const { away, home } = currentGame;
  const forTeam = (team) => (shotData[team.id] ?? [])
    .filter((s) => inSelectedPeriod(s) && (selectedPlayers.size === 0 || selectedPlayers.has(playerKey(s))));
  const awayShots = forTeam(away);
  const homeShots = forTeam(home);
  // With players picked, each team's caption names its picked player (or how
  // many, or just the team when its whole roster is picked), and dims if none
  // of its players are picked.
  const rosters = new Map(shooters());
  const captionName = (team) => {
    const roster = rosters.get(team);
    const players = roster.filter((p) => selectedPlayers.has(p.id));
    if (selectedPlayers.size === 0 || players.length === 0 || wholeTeamPicked(roster)) {
      return team.full_name;
    }
    if (players.length === 1) {
      return players[0].name;
    }
    return `${team.full_name} · ${players.length} players`;
  };
  const inactive = (team) => selectedPlayers.size > 0 && !rosters.get(team).some((p) => selectedPlayers.has(p.id));
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
        ${floorGrain(currentGame)}
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
function shootingLabel(made, attempts) {
  let pct = "";
  if (attempts > 0) {
    pct = ` (${((made / attempts) * 100).toFixed(1)}%)`;
  }
  return `${made}-${attempts}${pct}`;
}

function fgLabel(made, attempts) {
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
function recolorShotCharts() {
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
  if (!showCourtTrend || !playByPlay || !currentGame) {
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

function drawCourtTrend() {
  const layer = document.querySelector("#shotcharts .court-trend");
  if (layer) {
    layer.innerHTML = courtTrendMarkup();
  }
}

function toggleCourtTrend(event) {
  if (event.target.id !== "courtTrendToggle") {
    return;
  }

  showCourtTrend = event.target.checked;
  savePref("courtTrend", showCourtTrend);
  track("court_trend_toggle", { on: showCourtTrend });
  drawCourtTrend();
}

// Hot and cold zones under each team's shots: each of stats.nba.com's
// half-court zones shaded by how the team shot there against the league
// that season, warmer for better and colder for worse. Off until switched
// on (and remembered), which loads the league's numbers (null until then,
// "error" if they couldn't be loaded). During playback they count only the
// shots so far.
let showZones = loadPref("zones", false) === true;
let leagueZones = null;

// One zone shape's fill: the panel color with no attempts there, otherwise
// tinted toward hot or cold by how far off the league the team shot.
function zoneFill(team, league) {
  const comparison = zoneComparison(team, league);
  if (!comparison) {
    return "";
  }

  let color = "var(--zone-cold)";
  if (comparison.diff > 0) {
    color = "var(--zone-hot)";
  }
  // Kept light enough that the team-colored shots on top stay easy to see.
  return `fill: color-mix(in srgb, ${color} ${Math.round(8 + 32 * comparison.strength)}%, var(--panel))`;
}

function halfPath(side, points) {
  return `${pathFrom(points.map(([hx, hy]) => projectHalf(side, hx, hy)))} Z`;
}

// The zones for each half: [[team, shots, side], ...].
function zonesMarkup(halves) {
  if (!showZones || !leagueZones || leagueZones === "error") {
    return "";
  }

  return halves.map(([team, shots, side]) => {
    const totals = zoneTotals(shots);
    const clips = Object.entries(ZONE_CLIPS)
      .map(([name, points]) => `<clipPath id="zone-clip-${side}-${name}"><path d="${halfPath(side, points)}" /></clipPath>`)
      .join("");
    const layers = ZONE_LAYERS.map(({ zone, points, clip }) => {
      let clipPath = "";
      if (clip) {
        clipPath = ` clip-path="url(#zone-clip-${side}-${clip})"`;
      }
      return `<path class="zone" data-zone="${escapeHtml(zone)}" data-team="${team.id}" d="${halfPath(side, points)}"${clipPath}
        style="${zoneFill(totals[zone], leagueZones[zone])}" />`;
    }).join("");
    return clips + layers;
  }).join("");
}

// The shots a team's zones count: those launched so far during playback,
// otherwise every shot on its half.
function zoneShots(teamId) {
  if (playback) {
    return playback.shots.slice(0, playback.next)
      .filter((entry) => String(entry.team.id) === String(teamId))
      .map((entry) => entry.shot);
  }
  return shotsByTeam.get(String(teamId)) ?? [];
}

function drawZones() {
  const layer = document.querySelector("#shotcharts .zones-layer");
  if (!layer || !currentGame) {
    return;
  }

  const { away, home } = currentGame;
  const shown = showZones && leagueZones && leagueZones !== "error";
  if (shown && layer.querySelector(".zone")) {
    // Already drawn: only the fills change, so recolor in place. That keeps
    // any zone flashing for a shot (see pulseZone) going as playback counts it.
    const totals = { [away.id]: zoneTotals(zoneShots(away.id)), [home.id]: zoneTotals(zoneShots(home.id)) };
    for (const shape of layer.querySelectorAll(".zone")) {
      const { team, zone } = shape.dataset;
      shape.setAttribute("style", zoneFill(totals[team][zone], leagueZones[zone]));
    }
  } else {
    layer.innerHTML = zonesMarkup([[away, zoneShots(away.id), "left"], [home, zoneShots(home.id), "right"]]);
    outlineZone(layer.ownerSVGElement, null);
  }
  const key = document.querySelector("#shotcharts .zones-key");
  key.hidden = !showZones;
  key.innerHTML = zonesKeyMarkup();
}

function zonesKeyMarkup() {
  if (leagueZones === "error") {
    return "League averages couldn’t be loaded.";
  }
  return 'Colder <span class="zones-scale"></span> Hotter than the league';
}

// Fetches the league's numbers for the game on screen, once, then draws the zones.
async function loadLeagueZones() {
  if (leagueZones && leagueZones !== "error") {
    drawZones();
    return;
  }

  const token = loadToken;
  try {
    const zones = await getJson(`/api/shotzones?game_id=${currentGame.id}`);
    if (token === loadToken) {
      leagueZones = zones;
    }
  } catch (err) {
    if (token === loadToken) {
      leagueZones = "error";
      track("load_error", { section: "shotzones", game_id: currentGame.id, message: err.message });
    }
  }
  if (token === loadToken) {
    drawZones();
  }
}

function toggleZones(event) {
  if (event.target.id !== "zonesToggle") {
    return;
  }

  showZones = event.target.checked;
  savePref("zones", showZones);
  track("zones_toggle", { on: showZones });
  if (showZones) {
    loadLeagueZones();
  } else {
    drawZones();
  }
}

// Returns true when the pointer is over a zone (and no shot) and its tooltip is showing.
function showZoneTooltip(event) {
  const zone = event.target.closest?.(".zone");
  if (!zone) {
    return false;
  }

  const team = zoneTotals(zoneShots(zone.dataset.team))[zone.dataset.zone];
  const league = leagueZones?.[zone.dataset.zone];
  let line = "No shots";
  if (team) {
    line = `${team.fgm} of ${team.fga} (${((team.fgm / team.fga) * 100).toFixed(1)}%)`;
  }
  let leagueLine = "";
  if (league?.fga) {
    leagueLine = `<span class="muted">League ${((league.fgm / league.fga) * 100).toFixed(1)}%</span>`;
  }
  showTooltip(`
    <strong>${escapeHtml(ZONE_NAMES[zone.dataset.zone])}</strong>
    <span>${escapeHtml(line)}</span>
    ${leagueLine}`, event.clientX, event.clientY);
  return true;
}

// The player card: a modal over the game with a player's regular-season
// career, and their hot/cold zones for any season with shot data, on a
// half court seen from above with the hoop at the top.
const playerDialog = document.getElementById("playerDialog");

// The card on screen: { id, name, team, position, career, error, season,
// zones: Map(season -> zones data, "loading", or an Error) }.
let playerCard = null;

// Shot charts by player only go back to 1996-97.
const FIRST_SHOT_SEASON = 1996;

function perGame(total, games) {
  if (!games) {
    return "–";
  }
  return (total / games).toFixed(1);
}

function percent(made, attempts) {
  if (!attempts) {
    return "–";
  }
  return ((made / attempts) * 100).toFixed(1);
}

function seasonLabel(season) {
  return `${season}–${String(season + 1).slice(2)}`;
}

// How the career table counts: "perGame" averages or season "totals", and
// whether it shows every stat ("expanded") or the main ones. Remembered.
let cardMode = "perGame";
if (loadPref("cardMode", "perGame") === "totals") {
  cardMode = "totals";
}
let cardExpanded = loadPref("cardExpanded", false) === true;

// A counting stat, as an average or a total by the table's mode.
function counted(total, games) {
  if (cardMode === "totals") {
    return Math.round(total).toLocaleString();
  }
  return perGame(total, games);
}

// Effective FG% (a three counts half again) and true shooting % (counting
// free throws too), from totals.
function effectiveFg(t) {
  return percent(t.fgm + 0.5 * t.fg3m, t.fga);
}

function trueShooting(t) {
  return percent(t.pts, 2 * (t.fga + 0.44 * t.fta));
}

// The career table's stat columns, in order. `more` ones only show expanded.
// Shading compares a counting stat with the league's per minute played
// (`rate`, the totals key), and a percentage with the league's (`share`,
// returning [made, attempts] from totals). `worse` marks stats where more
// is bad, shaded the other way.
const shareOf = (made, attempts) => (t) => [t[made], t[attempts]];

// The career table's stat columns, in order. `more` ones only show expanded.
const CAREER_COLUMNS = [
  { label: "GP", value: (t) => t.gp },
  { label: "GS", value: (t) => t.gs, more: true },
  { label: "MIN", value: (t) => counted(t.min, t.gp) },
  { label: "PTS", value: (t) => counted(t.pts, t.gp), rate: "pts" },
  { label: "OREB", value: (t) => counted(t.oreb, t.gp), more: true, rate: "oreb" },
  { label: "DREB", value: (t) => counted(t.dreb, t.gp), more: true, rate: "dreb" },
  { label: "REB", value: (t) => counted(t.reb, t.gp), rate: "reb" },
  { label: "AST", value: (t) => counted(t.ast, t.gp), rate: "ast" },
  { label: "STL", value: (t) => counted(t.stl, t.gp), rate: "stl" },
  { label: "BLK", value: (t) => counted(t.blk, t.gp), rate: "blk" },
  { label: "TOV", value: (t) => counted(t.tov, t.gp), more: true, rate: "tov", worse: true },
  { label: "PF", value: (t) => counted(t.pf, t.gp), more: true, rate: "pf", worse: true },
  { label: "FGM", value: (t) => counted(t.fgm, t.gp), more: true, rate: "fgm" },
  { label: "FGA", value: (t) => counted(t.fga, t.gp), more: true, rate: "fga" },
  { label: "FG%", value: (t) => percent(t.fgm, t.fga), share: shareOf("fgm", "fga") },
  { label: "3PM", value: (t) => counted(t.fg3m, t.gp), more: true, rate: "fg3m" },
  { label: "3PA", value: (t) => counted(t.fg3a, t.gp), more: true, rate: "fg3a" },
  { label: "3P%", value: (t) => percent(t.fg3m, t.fg3a), share: shareOf("fg3m", "fg3a") },
  { label: "FTM", value: (t) => counted(t.ftm, t.gp), more: true, rate: "ftm" },
  { label: "FTA", value: (t) => counted(t.fta, t.gp), more: true, rate: "fta" },
  { label: "FT%", value: (t) => percent(t.ftm, t.fta), share: shareOf("ftm", "fta"), minAttempts: 10 },
  {
    label: "eFG%",
    value: effectiveFg,
    more: true,
    share: (t) => [t.fgm + 0.5 * t.fg3m, t.fga],
    title: "Effective field goal %: threes count half again",
  },
  {
    label: "TS%",
    value: trueShooting,
    more: true,
    share: (t) => [t.pts, 2 * (t.fga + 0.44 * t.fta)],
    title: "True shooting %: points per shot, free throws included",
  },
];

// Whether stats are shaded against the league that season. Remembered.
let cardShading = loadPref("cardShading", true) !== false;

// Too little to judge: rows with fewer minutes, and percentages on fewer
// attempts, aren't shaded.
const SHADE_MIN_MINUTES = 100;
const SHADE_MIN_ATTEMPTS = 20;

// A rate this many times the league's (or this fraction of it) gets the
// strongest shade; a percentage this far off the league's, in points.
const SHADE_FULL_RATIO = 2;
const SHADE_FULL_POINTS = 0.08;

// What a row is compared with: the league's per-minute rate for a totals
// key, and its percentage for a share. A season compares with that season;
// the career with the seasons it spans, weighted by the player's minutes
// (rates) or attempts (percentages). Null when the league's numbers for any
// of those seasons aren't in.
function seasonBaseline(league) {
  return {
    rate: (key) => league[key] / league.min,
    share: (share) => {
      const [made, attempts] = share(league);
      return made / attempts;
    },
  };
}

function careerBaseline() {
  const seasons = playerCard.career?.seasons ?? [];
  const leagues = seasons.map((s) => playerCard.league.get(s.season));
  if (seasons.length === 0 || leagues.some((league) => !league?.min)) {
    return null;
  }

  const weighted = (weight, value) => {
    let total = 0;
    let weights = 0;
    seasons.forEach((s, i) => {
      total += weight(s) * value(leagues[i]);
      weights += weight(s);
    });
    return total / weights;
  };
  return {
    rate: (key) => weighted((s) => s.min, (league) => league[key] / league.min),
    share: (share) => weighted((s) => share(s)[1], (league) => {
      const [made, attempts] = share(league);
      return made / attempts;
    }),
  };
}

// A cell's shade and tooltip against the baseline, as attributes; empty
// when it isn't compared.
function shadeAttrs(column, t, baseline) {
  if (!cardShading || !baseline || !(column.rate || column.share) || t.min < SHADE_MIN_MINUTES) {
    return "";
  }

  let strength;
  let better;
  let title;
  if (column.rate) {
    const own = t[column.rate] / t.min;
    const league = baseline.rate(column.rate);
    if (!league) {
      return "";
    }
    const ratio = own / league;
    strength = Math.min(Math.abs(Math.log(Math.max(ratio, 0.01)) / Math.log(SHADE_FULL_RATIO)), 1);
    better = ratio > 1;
    title = `${(own * 36).toFixed(1)} per 36 minutes; league ${(league * 36).toFixed(1)}`;
  } else {
    const [made, attempts] = column.share(t);
    if (attempts < (column.minAttempts ?? SHADE_MIN_ATTEMPTS)) {
      return "";
    }
    const league = baseline.share(column.share);
    const diff = made / attempts - league;
    strength = Math.min(Math.abs(diff) / SHADE_FULL_POINTS, 1);
    better = diff > 0;
    title = `League ${(league * 100).toFixed(1)}%`;
  }
  if (column.worse) {
    better = !better;
  }
  let color = "var(--zone-cold)";
  if (better) {
    color = "var(--zone-hot)";
  }
  return ` style="background: color-mix(in srgb, ${color} ${Math.round(6 + 34 * strength)}%, var(--panel))" title="${escapeHtml(title)}"`;
}

function careerColumns() {
  return CAREER_COLUMNS.filter((column) => cardExpanded || !column.more);
}

function careerRow(label, team, age, t, season, baseline) {
  let attrs = "";
  if (season != null) {
    const picked = playerCard.season === season;
    attrs = ` data-season="${season}" class="${picked ? "picked" : ""}"`;
    if (season < FIRST_SHOT_SEASON) {
      attrs = "";
    }
  }
  return `
    <tr${attrs}>
      <th>${escapeHtml(label)}</th>
      <td class="text">${escapeHtml(team)}</td>
      <td>${escapeHtml(age ?? "")}</td>
      ${careerColumns().map((column) => `<td${shadeAttrs(column, t, baseline)}>${escapeHtml(column.value(t))}</td>`).join("")}
    </tr>`;
}

// Per game or totals, and more stats or fewer, beside the table's heading.
// Arrows out to the table's edges to widen it, or in from them to narrow it.
const WIDEN_ICON = '<path d="M3 5v14M21 5v14M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3" />';
const NARROW_ICON = '<path d="M12 5v14M3 12h6M6 9l3 3-3 3M21 12h-6M18 9l-3 3 3 3" />';

function careerControls() {
  let expandIcon = WIDEN_ICON;
  let expandTitle = "Show more stats";
  if (cardExpanded) {
    expandIcon = NARROW_ICON;
    expandTitle = "Show fewer stats";
  }
  const mode = (value, label) =>
    `<button type="button" data-card-mode="${value}" aria-pressed="${cardMode === value}">${label}</button>`;
  return `
    <div class="card-controls">
      <div class="segmented" role="group" aria-label="Show stats">
        ${mode("perGame", "Per game")}${mode("totals", "Totals")}
      </div>
      <button type="button" id="cardShading" class="card-expand" aria-pressed="${cardShading}"
        title="Shade stats against the league that season">vs league</button>
      <button type="button" id="cardExpand" class="card-expand card-icon" aria-pressed="${cardExpanded}"
        aria-label="More stats" title="${expandTitle}">
        <svg viewBox="0 0 24 24" aria-hidden="true">${expandIcon}</svg>
      </button>
    </div>`;
}

function careerTable() {
  const { career, error } = playerCard;
  if (error) {
    return `<p class="notice">${escapeHtml(error)}</p>`;
  }

  const columns = careerColumns();
  // Until the career arrives, the table shows its headers and a loading row,
  // so the card doesn't jump when it fills in.
  let rows = `<tr><td class="text hint" colspan="${columns.length + 3}">Loading career…</td></tr>`;
  let totals = "";
  if (career) {
    rows = career.seasons.map((s) => {
      const league = playerCard.league.get(s.season);
      let baseline = null;
      if (league?.min) {
        baseline = seasonBaseline(league);
      }
      return careerRow(seasonLabel(s.season), s.team, s.age, s, s.season, baseline);
    }).join("");
  }
  if (career?.career) {
    totals = `<tfoot>${careerRow("Career", "", null, career.career, null, careerBaseline())}</tfoot>`;
  }
  const headers = columns
    .map((column) => `<th${column.title ? ` title="${escapeHtml(column.title)}"` : ""}>${column.label}</th>`)
    .join("");
  let note = "Per game";
  if (cardMode === "totals") {
    note = "Season totals";
  }
  let shading = "";
  if (cardShading) {
    shading = " Shading compares each stat with the league that season (per minute for counts): red above average, blue below, reversed for turnovers and fouls.";
  }
  return `
    <div class="table-wrap">
      <table class="stats career">
        <thead>
          <tr><th>Season</th><th class="text">Team</th><th>Age</th>${headers}</tr>
        </thead>
        <tbody>${rows}</tbody>
        ${totals}
      </table>
    </div>
    <p class="hint">${note}, regular season. Click a season to see its zones.${shading}</p>`;
}

// Seasons with shot data, newest first.
function zoneSeasons() {
  return (playerCard.career?.seasons ?? [])
    .map((s) => s.season)
    .filter((season) => season >= FIRST_SHOT_SEASON)
    .reverse();
}

function flatPath(points, close = true) {
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${round1(x)} ${round1(y)}`).join(" ");
  if (close) {
    return `${d} Z`;
  }
  return d;
}

// A half court seen from above, hoop at the top: hoop coordinates drawn as
// they are, x across and y toward half court (down the screen).
function playerZonesCourt(data) {
  const clips = Object.entries(ZONE_CLIPS)
    .map(([name, points]) => `<clipPath id="card-clip-${name}"><path d="${flatPath(points)}" /></clipPath>`)
    .join("");
  const zones = ZONE_LAYERS.map(({ zone, points, clip }) => {
    let clipPath = "";
    if (clip) {
      clipPath = ` clip-path="url(#card-clip-${clip})"`;
    }
    return `<path class="zone" data-zone="${escapeHtml(zone)}" d="${flatPath(points)}"${clipPath} style="${zoneFill(data.zones[zone], data.league[zone])}" />`;
  }).join("");
  const lines = HALF_COURT_LINES.map(({ points, dashed, kind }) =>
    `<path class="court-line${dashed ? " dashed" : ""}${kind ? ` ${kind}` : ""}" d="${flatPath(points, false)}" />`).join("");
  const labels = Object.entries(ZONE_LABEL_SPOTS).map(([zone, [x, y]]) => {
    const team = data.zones[zone];
    if (!team?.fga) {
      return `<text class="zone-label empty" x="${x}" y="${y}">–</text>`;
    }
    return `
      <text class="zone-label" x="${x}" y="${y}">${Math.round((team.fgm / team.fga) * 100)}%</text>
      <text class="zone-count" x="${x}" y="${y + 15}">${team.fgm}/${team.fga}</text>`;
  }).join("");
  return `
    <svg class="card-court" viewBox="-260 -60 520 492" role="img"
      aria-label="${escapeHtml(`${playerCard.name}'s shooting by zone`)}">
      <rect class="court-floor" x="-250" y="-47.5" width="500" height="470" />
      ${clips}
      ${zones}
      ${lines}
      <g class="zone-outline" aria-hidden="true"></g>
      <path class="backboard-line" d="M -30 -7.5 L 30 -7.5" />
      <circle class="rim" cx="0" cy="0" r="7.5" />
      ${labels}
    </svg>`;
}

// The zones as a list: the player's shooting against the league's.
function playerZonesList(data) {
  const rows = Object.keys(ZONE_NAMES).map((zone) => {
    const team = data.zones[zone];
    const league = data.league[zone];
    const comparison = zoneComparison(team, league);
    let diff = "";
    let tone = "";
    if (comparison) {
      const points = comparison.diff * 100;
      diff = `${points >= 0 ? "+" : ""}${points.toFixed(1)}`;
      tone = points >= 0 ? "hot" : "cold";
    }
    return `
      <tr data-zone="${escapeHtml(zone)}">
        <th>${escapeHtml(ZONE_NAMES[zone])}</th>
        <td>${team ? `${team.fgm}/${team.fga}` : "–"}</td>
        <td>${team ? percent(team.fgm, team.fga) : "–"}</td>
        <td>${league ? percent(league.fgm, league.fga) : "–"}</td>
        <td class="${tone}">${diff}</td>
      </tr>`;
  }).join("");
  return `
    <div class="table-wrap">
      <table class="stats zone-list">
        <thead><tr><th>Zone</th><th>FG</th><th>FG%</th><th>League</th><th>+/-</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// No shots anywhere: the court and list drawn empty while a season loads.
const NO_ZONES = { zones: {}, league: {} };

function playerZonesSection() {
  const { career, error } = playerCard;
  if (error) {
    return "";
  }
  const seasons = zoneSeasons();
  if (career && seasons.length === 0) {
    return '<p class="hint">No shot data: it starts with the 1996–97 season.</p>';
  }

  // The court and the zone list are always drawn, empty until a season's
  // zones arrive, so the card keeps its size while they load; only the line
  // under them says what's going on.
  let options = "<option>Loading…</option>";
  if (seasons.length > 0) {
    options = seasons
      .map((season) => `<option value="${season}"${season === playerCard.season ? " selected" : ""}>${seasonLabel(season)}</option>`)
      .join("");
  }
  const data = playerCard.zones.get(playerCard.season);
  let shown = NO_ZONES;
  let status = "<span>Loading zones…</span>";
  if (data instanceof Error) {
    status = `<span class="notice">${escapeHtml(data.message)}</span>`;
  } else if (data && data !== "loading") {
    shown = data;
    status = `<span>${Object.values(data.zones).reduce((sum, z) => sum + z.fga, 0)} shots</span>`;
  }
  return `
    <div class="card-zones-head">
      <h3>Hot/cold zones</h3>
      <label>Season <select id="cardZoneSeason"${seasons.length === 0 ? " disabled" : ""}>${options}</select></label>
    </div>
    <div class="card-zones-body">
      ${playerZonesCourt(shown)}
      ${playerZonesList(shown)}
    </div>
    <p class="legend">
      ${status}
      <span class="zones-key">Colder <span class="zones-scale"></span> Hotter than the league</span>
    </p>`;
}

function renderPlayerCard() {
  if (!playerCard) {
    return;
  }

  const { name, team, position } = playerCard;
  playerDialog.classList.toggle("expanded", cardExpanded);
  const about = [team?.full_name, position].filter(Boolean).join(" · ");
  playerDialog.innerHTML = `
    <div class="player-card">
      <header class="player-card-header">
        <div>
          <h2 id="playerDialogTitle">${escapeHtml(name)}</h2>
          <p class="player-card-about">${escapeHtml(about)}</p>
        </div>
        <button type="button" class="player-card-close" aria-label="Close">×</button>
      </header>
      <section>
        <div class="card-section-head">
          <h3>Career</h3>
          ${careerControls()}
        </div>
        ${careerTable()}
      </section>
      <section class="card-zones">${playerZonesSection()}</section>
    </div>`;
}

async function loadPlayerZones(season) {
  const card = playerCard;
  card.season = season;
  if (card.zones.has(season)) {
    renderPlayerCard();
    return;
  }

  card.zones.set(season, "loading");
  renderPlayerCard();
  try {
    card.zones.set(season, await getJson(`/api/playerzones?player_id=${card.id}&season=${season}`));
  } catch (err) {
    card.zones.set(season, err);
  }
  if (card === playerCard) {
    renderPlayerCard();
  }
}

// Fetches the league's totals for each of the player's seasons with them,
// one at a time so a long career doesn't fire a burst of requests, shading
// each season as its totals arrive. Seasons that can't be loaded stay plain.
async function loadLeagueSeasons(card) {
  for (const season of zoneSeasons().reverse()) {
    try {
      card.league.set(season, await getJson(`/api/league?season=${season}`));
    } catch {
      card.league.set(season, null);
    }
    if (card !== playerCard) {
      return;
    }
    renderPlayerCard();
  }
}

async function openPlayerCard(event) {
  const button = event.target.closest(".player-link");
  if (!button) {
    return;
  }

  const row = currentStats.find((r) => String(r.player_id) === button.dataset.player);
  const card = {
    id: button.dataset.player,
    name: `${row.first_name} ${row.last_name}`,
    team: teamById(row.team_id),
    position: row.position,
    career: null,
    error: null,
    season: null,
    zones: new Map(),
    league: new Map(),
  };
  playerCard = card;
  track("player_card_open", { player_id: Number(card.id), player: card.name });
  hideTooltip();
  renderPlayerCard();
  playerDialog.showModal();

  try {
    card.career = await getJson(`/api/player?player_id=${card.id}`);
  } catch (err) {
    card.error = err.message;
  }
  if (card !== playerCard) {
    return;
  }
  loadLeagueSeasons(card);
  // Start with the zones for the season of the game on screen, if the player
  // has them, or else their latest.
  const seasons = zoneSeasons();
  const gameSeason = Number(seasonSelect.value);
  if (seasons.length === 0) {
    renderPlayerCard();
    return;
  }
  loadPlayerZones(seasons.includes(gameSeason) ? gameSeason : seasons[0]);
}

// Outlines a zone on the card's court while it, or its row in the zone
// list, is hovered.
function outlineCardZone(event) {
  const hovered = event.target.closest(".card-court .zone, .zone-list tr[data-zone]");
  outlineZone(playerDialog.querySelector(".card-court"), hovered?.dataset.zone);
}

function playerCardClick(event) {
  // A click on the backdrop lands on the dialog itself.
  if (event.target === playerDialog || event.target.closest(".player-card-close")) {
    playerDialog.close();
    return;
  }

  const mode = event.target.closest("[data-card-mode]");
  if (mode) {
    cardMode = mode.dataset.cardMode;
    savePref("cardMode", cardMode);
    track("player_card_mode", { mode: cardMode });
    renderPlayerCard();
    return;
  }
  if (event.target.closest("#cardShading")) {
    cardShading = !cardShading;
    savePref("cardShading", cardShading);
    track("player_card_shading", { on: cardShading });
    renderPlayerCard();
    playerDialog.querySelector("#cardShading").focus();
    return;
  }
  if (event.target.closest("#cardExpand")) {
    cardExpanded = !cardExpanded;
    savePref("cardExpanded", cardExpanded);
    track("player_card_expand", { expanded: cardExpanded });
    renderPlayerCard();
    playerDialog.querySelector("#cardExpand").focus();
    return;
  }

  const row = event.target.closest("tr[data-season]");
  if (row) {
    track("player_card_season", { player_id: Number(playerCard.id), season: Number(row.dataset.season), source: "career" });
    loadPlayerZones(Number(row.dataset.season));
  }
}

function playerCardChange(event) {
  if (event.target.id === "cardZoneSeason") {
    track("player_card_season", { player_id: Number(playerCard.id), season: Number(event.target.value), source: "menu" });
    loadPlayerZones(Number(event.target.value));
  }
}

// Sets --team on a play-by-play row so its hover tint is the team's primary color.
function teamRowStyle(tricode) {
  const { away, home } = currentGame;
  const color = [away, home].find((t) => t.abbreviation === tricode)?.colors?.primary;
  if (!color) {
    return "";
  }
  return ` style="--team: ${escapeHtml(teamColor(color))}"`;
}

function renderPlayByPlay() {
  if (playByPlay.length === 0) {
    return '<p class="hint">No play-by-play for this game.</p>';
  }
  const plays = playByPlay.filter(inSelectedPeriod);
  if (plays.length === 0) {
    return '<p class="hint">No plays in this quarter.</p>';
  }

  const { away, home } = currentGame;
  let lastPeriod = null;
  const rows = plays.map((p) => {
    // When showing every quarter, label where each one starts.
    let divider = "";
    if (selectedPeriod === "all" && p.period !== lastPeriod) {
      divider = `<tr class="period-divider"><th colspan="4">${escapeHtml(p.period_label)}</th></tr>`;
    }
    lastPeriod = p.period;
    return `${divider}
    <tr data-play="${p.id}" class="${p.scored ? "scored" : ""}${isMadeFreeThrow(p) ? " free-throw-made" : ""}"${teamRowStyle(p.team)}>
      <td>${escapeHtml(p.clock)}</td>
      <td class="team">${escapeHtml(p.team ?? "")}</td>
      <td class="play">${escapeHtml(p.description)}</td>
      <td>${p.score.away}–${p.score.home}</td>
    </tr>`;
  }).join("");

  return `
    <div class="table-wrap">
      <table class="pbp">
        <thead>
          <tr><th>Time</th><th>Team</th><th>Play</th><th>${escapeHtml(away.abbreviation)}–${escapeHtml(home.abbreviation)}</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function selectPeriod(event) {
  const button = event.target.closest("#periodTabs button");
  if (!button) {
    return;
  }

  showPeriod(button.dataset.period === "all" ? "all" : Number(button.dataset.period), "tab");
}

// Filters the charts and play-by-play to a quarter ("all" for the whole
// game). `source` says how it was picked, for tracking.
function showPeriod(period, source) {
  selectedPeriod = period;
  track("period_select", { period: selectedPeriod, source });
  stopPlayback();
  writeHash();
  refreshPeriodTabs();
  hideTooltip();
  if (shotData) {
    document.getElementById("shotcharts").innerHTML = renderShotCharts();
  }
  if (playByPlay) {
    document.getElementById("playbyplay").innerHTML = renderPlayByPlay();
    drawScoreTrend();
  }
}

// Keyboard shortcuts for the game: Space plays or pauses, and the left and
// right arrows step through the quarter tabs. They stay out of the way of
// anything that takes those keys itself: form fields, the player menu, the
// focusable scoring trend (its arrows step through plays), and the control
// panel. Space on a focused button already clicks it.
function gameShortcuts(event) {
  if (!currentGame || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }
  if (playerDialog.open || event.target.closest("input, select, textarea, [tabindex], .panel, .player-menu")) {
    return;
  }

  if (event.key === " ") {
    if (event.target.closest("button, a, summary")) {
      return;
    }

    const button = playButton();
    if (button && !button.disabled) {
      event.preventDefault();
      button.click();
    }
    return;
  }

  let step = 0;
  if (event.key === "ArrowLeft") {
    step = -1;
  } else if (event.key === "ArrowRight") {
    step = 1;
  }
  if (step === 0) {
    return;
  }

  const options = ["all", ...gamePeriods()];
  const next = options[options.indexOf(selectedPeriod) + step];
  if (next !== undefined) {
    event.preventDefault();
    showPeriod(next, "keyboard");
  }
}

// Shot chart playback: starting from blank courts, reveals each shot in game
// order, one at a time across both charts. The game clock holds while a shot
// is in flight, and runs faster between shots so a 12-minute quarter still
// takes about 30 seconds in total.

const PLAY_MS_PER_GAME_SECOND = 30_000 / 720;

// The clock always keeps at least this share of the time budget, so busy
// quarters run a little long rather than jumping straight from shot to shot.
const MIN_CLOCK_SHARE = 0.25;

// After a shot lands, how long its after-effects take: a make's burst ring, a
// miss's arc fading out. The next shot waits for them.
const MAKE_SETTLE_MS = 450;
const MISS_SETTLE_MS = 250;

// Shots that just appear (no flight) still get a beat before the next one.
const SHOT_GAP_MS = 150;

// Busy quarters speed the shot animations up to fit the time budget, but never
// past this fraction of their normal length.
const MIN_PACE = 0.6;

// How fast playback runs, picked with the speed button: the clock and the
// shot animations both run this many times faster. Remembered.
// The button steps through them in order, wrapping around: from the default
// 1×, up to 4×, then down to half speed.
const PLAYBACK_RATES = [1, 2, 4, 0.5];
let playbackRate = 1;
const savedSpeed = loadPref("speed", 1);
if (PLAYBACK_RATES.includes(savedSpeed)) {
  playbackRate = savedSpeed;
}

// Scales an animation length by the current playback's pace and speed. A
// shot replayed on its own (no playback) keeps its normal length.
function paced(ms) {
  if (!playback) {
    return ms;
  }

  return (ms * playback.pace) / playbackRate;
}

// The CSS animations (shots landing) follow the same pace and speed.
function applyPace() {
  document.getElementById("shotcharts")?.style.setProperty("--pace", playback.pace / playbackRate);
}

// "2×", or "½×" for half speed.
function speedLabel(rate) {
  if (rate === 0.5) {
    return "½×";
  }
  return `${rate}×`;
}

// Steps to the next speed, wrapping back to 1×. Takes effect immediately,
// even mid-playback.
function cycleSpeed(event) {
  const button = event.target.closest("#speedButton");
  if (!button) {
    return;
  }

  playbackRate = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(playbackRate) + 1) % PLAYBACK_RATES.length];
  savePref("speed", playbackRate);
  track("playback_speed", { rate: playbackRate });
  button.textContent = speedLabel(playbackRate);
  button.setAttribute("aria-label", `Playback speed ${speedLabel(playbackRate)}`);
  if (playback) {
    applyPace();
  }
}

const PLAY_LABELS = {
  play: '<span aria-hidden="true">▶</span> Play',
  pause: '<span aria-hidden="true">❚❚</span> Pause',
  replay: '<span aria-hidden="true">↺</span> Replay',
};

// While a playback exists (playing or paused): { t0, t1, lastPeriod, playhead,
// speed, jump, pace, frame, lastFrame, shots, next, inFlight }. `shots` are both
// teams' shots in order; `next` is how many have been launched.
let playback = null;

function playButton() {
  return document.getElementById("playButton");
}

// "Q2 · 7:31" for a time in seconds since tip-off. The end of a period is also
// the start of the next, so stay on lastPeriod at the window's end ("Q1 · 0:00").
function clockLabel(t, lastPeriod) {
  let period = 1;
  while (t >= periodStart(period) + periodLength(period) && period < lastPeriod) {
    period++;
  }
  const left = Math.max(0, Math.ceil(periodStart(period) + periodLength(period) - t));
  return `${periodLabel(period)} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

// Updates each chart's FG count, the clock, and the trend to
// match the shots launched so far.
function renderPlayhead() {
  const launched = playback.shots.slice(0, playback.next);
  for (const fg of document.querySelectorAll("#shotcharts .fg")) {
    const own = launched.filter((s) => String(s.team.id) === fg.dataset.team);
    const made = own.filter((s) => s.shot.made).length;
    fg.textContent = fgLabel(made, own.length);
  }
  document.getElementById("playClock").textContent = clockLabel(Math.min(playback.playhead, playback.t1), playback.lastPeriod);
  applyTrendPlayhead();
  if (showZones && playback.zoneCount !== playback.next) {
    playback.zoneCount = playback.next;
    drawZones();
  }
}

function teamById(id) {
  const { away, home } = currentGame;
  return [away, home].find((t) => String(t.id) === String(id));
}

// Starts the next shot's flight; the clock resumes once it has landed.
function launchNext() {
  const run = playback;
  const entry = playback.shots[playback.next];
  playback.next++;
  followPlay(entry.shot.play_id);
  playback.inFlight = true;
  playback.atRim = false;
  launchShot(entry.mark).then(() => {
    if (run === playback) {
      playback.inFlight = false;
    }
  });
}

function tick(now) {
  // Frame timestamps can trail performance.now() (Firefox), so never step backward.
  const elapsed = Math.max(now - playback.lastFrame, 0);
  playback.lastFrame = now;
  if (!playback.inFlight) {
    // Run the clock up to the next shot (or the end), then launch it.
    const next = playback.shots[playback.next];
    const target = next ? next.t : playback.t1;
    if (playback.jump) {
      playback.playhead = target;
    } else {
      playback.playhead = Math.min(playback.playhead + (elapsed / 1000) * playback.speed * playbackRate, target);
    }
    if (next && playback.playhead >= next.t) {
      launchNext();
    }
  }
  renderPlayhead();
  if (playback.playhead >= playback.t1 && !playback.inFlight) {
    playback.frame = null;
    playButton().innerHTML = PLAY_LABELS.replay;
    playButton().setAttribute("aria-pressed", "false");
    return;
  }

  playback.frame = requestAnimationFrame(tick);
}

function resumePlayback() {
  playback.lastFrame = performance.now();
  playback.frame = requestAnimationFrame(tick);
  playButton().innerHTML = PLAY_LABELS.pause;
  playButton().setAttribute("aria-pressed", "true");
}

function pausePlayback() {
  cancelAnimationFrame(playback.frame);
  playback.frame = null;
  playButton().innerHTML = PLAY_LABELS.play;
  playButton().setAttribute("aria-pressed", "false");
}

// Play starts from blank courts (or resumes if paused); Pause holds the
// current shots; Replay starts over.
function togglePlayback(event) {
  if (!event.target.closest("#playButton") || !shotData) {
    return;
  }

  if (playback?.frame) {
    track("playback", { action: "pause", playhead: playback.playhead });
    pausePlayback();
    return;
  }

  if (playback) {
    let action = "resume";
    if (playback.playhead >= playback.t1) {
      action = "replay";
    }
    track("playback", { action, period: selectedPeriod, players: [...selectedPlayers] });
  } else {
    track("playback", { action: "play", period: selectedPeriod, players: [...selectedPlayers] });
  }
  // Playback animates the shot charts, so show them.
  document.getElementById("shotchartsSection").open = true;

  if (!playback || playback.playhead >= playback.t1) {
    startPlayback();
  }
  resumePlayback();
}

// Sets up a playback, paused at the start of the selected window: blank
// courts, both teams' shots queued in the order they happened.
function startPlayback() {
  const { last, t0, t1 } = selectedWindow();
  // Both teams' shots in the selected quarter, in the order they happened.
  const charts = document.getElementById("shotcharts");
  const shots = [...shotsByTeam].flatMap(([teamId, teamShots]) => teamShots.map((shot, i) => ({
    shot,
    team: teamById(teamId),
    t: gameSeconds(shot),
    mark: charts.querySelector(`.shot[data-team="${teamId}"][data-shot="${i}"]`),
  }))).sort((a, b) => a.t - b.t);
  for (const { mark } of shots) {
    mark.classList.remove("revealed", "burst");
  }

  // Fit flights plus clock time into the budget for this span of the game.
  // Speed animations up if they'd crowd out the clock, then give the clock the
  // rest. Picked players' shots are few, so they just play back to back at
  // full animation length, the clock jumping from shot to shot.
  const jump = selectedPlayers.size > 0;
  const budget = (t1 - t0) * PLAY_MS_PER_GAME_SECOND;
  const flying = shots.reduce((sum, s) => sum + flightDuration(s.shot) + settleDuration(s.shot), 0);
  const room = budget * (1 - MIN_CLOCK_SHARE);
  let pace = Math.max(Math.min(room / flying, 1), MIN_PACE);
  if (jump) {
    pace = 1;
  }
  const clockMs = Math.max(budget - flying * pace, budget * MIN_CLOCK_SHARE);
  playback = {
    t0,
    t1,
    lastPeriod: last,
    playhead: t0,
    speed: (t1 - t0) / (clockMs / 1000),
    jump,
    pace,
    frame: null,
    lastFrame: 0,
    shots,
    next: 0,
    inFlight: false,
  };
  applyPace();
  clearFlights();
  document.getElementById("shotcharts").classList.add("animating");
  hideTooltip();
  renderPlayhead();
}

// Puts the court at the moment a shot was taken: the shots before it shown,
// and the clock, score, FG counts, and zones as they stood, with the shot
// itself flying in. Playback stays paused there, and Play carries on from it.
function seekToShot(mark) {
  ensurePlayback();
  const index = playback.shots.findIndex((entry) => entry.mark === mark);
  if (index === -1) {
    return;
  }

  jumpPlayback(index, playback.shots[index].t);
  launchNext();
  renderPlayhead();
}

// Puts the court just after a play that isn't a shot on the chart, like a
// made free throw: every shot taken by then shown, and the clock, score, FG
// counts, and zones as they stood. Playback stays paused there.
function seekToPlay(play) {
  ensurePlayback();
  const t = gameSeconds(play);
  if (t < playback.t0 || t > playback.t1) {
    return;
  }

  // Shots are in game order; those at the play's own second came first (an
  // and-one's basket before its free throw).
  jumpPlayback(playback.shots.filter((entry) => entry.t <= t).length, t);
  renderPlayhead();
}

// A paused playback to jump around in: the current one, or a new one if
// there's none or it has finished.
function ensurePlayback() {
  if (!playback || playback.playhead >= playback.t1) {
    startPlayback();
  }
}

// Moves the paused playback to game time t, with the first `next` shots
// shown and the rest still to come.
function jumpPlayback(next, t) {
  // A new run, so flights from before the jump can't reveal shots or end
  // a later one's flight when they land.
  playback = { ...playback, frame: null, inFlight: false };
  clearFlights();
  playback.shots.forEach((entry, i) => {
    entry.mark.classList.toggle("revealed", i < next);
    entry.mark.classList.remove("burst", "replaying");
  });
  playback.next = next;
  playback.playhead = t;
  playButton().innerHTML = PLAY_LABELS.play;
  playButton().setAttribute("aria-pressed", "false");
}

// Shot flights: as playback reveals a shot, it flies from the shot spot to the
// hoop on a parabola through the air. On a make a basketball rides it with a
// shadow sliding along the floor beneath, the rim flashes, and the dot lands
// with a big burst; a miss draws a gray arc that comes down just off the rim.
// Flights keep going while paused, since they're short.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

// Shots right under the rim have no room for an arc; reveal them at once.
const MIN_FLIGHT_DISTANCE = 20;

// Shots leave the hand about 8 ft up and peak higher the longer they are:
// roughly 13 ft for a layup, 17 ft for a three.
const RELEASE_HEIGHT = 80;
const FLIGHT_STEPS = 40;

// The flight as points from release (u = 0) to the end (u = 1), each with
// where it is in the air and its shadow on the floor, both on screen.
function flightPoints(side, shot, endX, endY) {
  const distance = Math.hypot(shot.x - endX, shot.y - endY);
  const rise = 25 + distance * 0.2;
  const points = [];
  for (let i = 0; i <= FLIGHT_STEPS; i++) {
    const u = i / FLIGHT_STEPS;
    const hx = shot.x + (endX - shot.x) * u;
    const hy = shot.y + (endY - shot.y) * u;
    const z = RELEASE_HEIGHT + (RIM_HEIGHT - RELEASE_HEIGHT) * u + 4 * rise * u * (1 - u);
    points.push({ air: projectHalf(side, hx, hy, z), ground: projectHalf(side, hx, hy), z });
  }
  return points;
}

// The point a fraction u of the way along the flight, between samples.
function flightAt(points, u) {
  const i = Math.min(Math.floor(u * FLIGHT_STEPS), FLIGHT_STEPS - 1);
  const f = u * FLIGHT_STEPS - i;
  const mix = (a, b) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, scale: a.scale + (b.scale - a.scale) * f });
  return { air: mix(points[i].air, points[i + 1].air), ground: mix(points[i].ground, points[i + 1].ground), z: points[i].z + (points[i + 1].z - points[i].z) * f };
}

// Flights from an earlier run (before Replay or a stop) must not reveal anything.
function revealMark(mark, burst, run = playback) {
  if (run !== playback) {
    return;
  }
  mark.classList.add("revealed");
  mark.classList.toggle("burst", burst);
}

// How long a shot's flight takes before it lands (0 when it just appears).
function flightDuration(shot) {
  const distance = Math.hypot(shot.x, shot.y);
  if (reduceMotion.matches || distance < MIN_FLIGHT_DISTANCE) {
    return 0;
  }
  return Math.min(350 + distance * 1.2, 750);
}

function settleDuration(shot) {
  if (flightDuration(shot) === 0) {
    return SHOT_GAP_MS;
  }
  return shot.made ? MAKE_SETTLE_MS : MISS_SETTLE_MS;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function madeVar(color) {
  if (!color) {
    return "";
  }
  return `--made: ${color}`;
}

// How long a zone's flash lasts when a shot is taken from it.
const ZONE_PULSE_MS = 700;

// With hot/cold zones on, flashes the zone a shot is taken from in the
// shooting team's color. Each of the zone's shapes gets a copy just above
// it, so the zones painted over it cover the flash too, and only the part of
// the floor that's in the zone lights up.
function pulseZone(mark, shot) {
  if (!showZones || reduceMotion.matches || !shot.zone) {
    return;
  }

  const shapes = mark.ownerSVGElement.querySelectorAll(
    `.zone[data-team="${mark.dataset.team}"][data-zone="${shot.zone}"]`,
  );
  const color = mark.closest(".half").style.getPropertyValue("--made");
  for (const shape of shapes) {
    const pulse = svgEl("path", { class: "zone-pulse", d: shape.getAttribute("d"), style: madeVar(color) });
    const clip = shape.getAttribute("clip-path");
    if (clip) {
      pulse.setAttribute("clip-path", clip);
    }
    shape.after(pulse);
    pulse.animate(
      [{ opacity: 0 }, { opacity: 0.45, offset: 0.25 }, { opacity: 0 }],
      { duration: paced(ZONE_PULSE_MS), easing: "ease-out" },
    ).finished.then(() => pulse.remove(), () => pulse.remove());
  }
}

// How wide a hovered zone's outline is, in screen pixels.
const ZONE_OUTLINE_PX = 1.5;
let zoneOutlines = 0;

// Outlines a zone on a court (only a team's zones, when given) where it
// shows: its shapes, less what the zones painted over them cover. A plain
// stroke would trace the hidden parts too, so the court's zones are copied
// into a mask, this zone's white and the rest black, and a filter keeps just
// the inside edge of the white. No zone clears the outline.
function outlineZone(svg, zone, team) {
  const layer = svg?.querySelector(".zone-outline");
  if (!layer) {
    return;
  }
  const key = zone ? `${team ?? ""}|${zone}` : "";
  if (layer.dataset.key === key) {
    return;
  }

  layer.dataset.key = key;
  layer.replaceChildren();
  const shapes = [...svg.querySelectorAll(".zone")].filter((shape) => team == null || shape.dataset.team === team);
  const own = shapes.filter((shape) => shape.dataset.zone === zone);
  if (own.length === 0) {
    return;
  }

  // The zone shows only inside its own shapes, so the mask and filter cover
  // just those, with room for the edge.
  const unit = 1 / (svg.getScreenCTM()?.a || 1);
  const pad = 4 * unit;
  const boxes = own.map((shape) => shape.getBBox());
  const x = Math.min(...boxes.map((box) => box.x)) - pad;
  const y = Math.min(...boxes.map((box) => box.y)) - pad;
  const bounds = {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) + pad - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) + pad - y,
  };
  const id = `zone-outline-${++zoneOutlines}`;
  const mask = svgEl("mask", { id: `${id}-mask`, maskUnits: "userSpaceOnUse", ...bounds });
  for (const shape of shapes) {
    let fill = "black";
    if (shape.dataset.zone === zone) {
      fill = "white";
    }
    const copy = svgEl("path", { d: shape.getAttribute("d"), fill });
    const clip = shape.getAttribute("clip-path");
    if (clip) {
      copy.setAttribute("clip-path", clip);
    }
    mask.append(copy);
  }
  const filter = svgEl("filter", { id: `${id}-edge`, filterUnits: "userSpaceOnUse", ...bounds });
  filter.append(
    svgEl("feMorphology", { in: "SourceAlpha", operator: "erode", radius: ZONE_OUTLINE_PX * unit, result: "inner" }),
    svgEl("feComposite", { in: "SourceAlpha", in2: "inner", operator: "out", result: "edge" }),
    svgEl("feFlood", {}),
    svgEl("feComposite", { in2: "edge", operator: "in" }),
  );
  const outline = svgEl("g", { filter: `url(#${id}-edge)` });
  outline.append(svgEl("rect", { ...bounds, mask: `url(#${id}-mask)` }));
  layer.append(svgEl("defs", {}), outline);
  layer.firstChild.append(mask, filter);
}

// Outlines the zone under the pointer on the game's court, if any.
function outlineHoveredZone(event) {
  const svg = document.querySelector("#shotcharts svg");
  const zone = event.target.closest?.("#shotcharts .zone");
  outlineZone(svg, zone?.dataset.zone, zone?.dataset.team);
}

// Animates one shot and resolves shortly after it lands.
// Names the player taking a shot in their team's caption, and clears the
// other team's, so only the current shooter is named. A caption already
// showing that one player's name is left alone.
// Their shooting line counts the same shots as the team's beside it: those
// launched so far during playback, otherwise every shot on the chart.
function showShooter(mark, shot) {
  const charts = mark.closest("#shotcharts");
  let shots = shotsByTeam.get(mark.dataset.team) ?? [];
  if (playback) {
    shots = playback.shots.slice(0, playback.next).map((entry) => entry.shot);
  }
  const own = shots.filter((s) => playerKey(s) === playerKey(shot));
  const line = shootingLabel(own.filter((s) => s.made).length, own.length);

  for (const slot of charts.querySelectorAll(".court-team .shooter")) {
    const caption = slot.parentElement.querySelector("strong").textContent;
    slot.innerHTML = "";
    if (slot.dataset.team === mark.dataset.team && shot.player !== caption) {
      slot.innerHTML = `<span class="shooter-name">${escapeHtml(shot.player)}</span> <span class="shooter-fg">${line}</span>`;
    }
  }
}

// The shot in the air has reached the hoop: its points count from now, so
// the trends climb as the make bursts instead of after it settles. `run` is
// the playback that launched the shot; a replayed shot or a stopped run
// changes nothing.
function reachRim(run) {
  if (!run || run !== playback) {
    return;
  }

  playback.atRim = true;
  applyTrendPlayhead();
}

// True while a shot is in the air and hasn't reached the hoop. The playhead
// waits at the shot's moment meanwhile, and scores from that moment (the
// shot, and any free throws after it) are held back.
function scoreHeld() {
  return Boolean(playback?.inFlight && !playback.atRim);
}

function launchShot(mark) {
  const shot = shotsByTeam.get(mark.dataset.team)?.[mark.dataset.shot];
  if (shot) {
    showShooter(mark, shot);
    pulseZone(mark, shot);
  }
  const flights = mark.ownerSVGElement.querySelector(".flights");
  const side = mark.closest(".half").dataset.side;
  const duration = shot ? paced(flightDuration(shot)) : 0;
  if (duration === 0) {
    revealMark(mark, false);
    reachRim(playback);
    return wait(paced(SHOT_GAP_MS));
  }

  // Misses come down just beside the rim, on a side that varies shot to shot.
  let endX = 0;
  let endY = 0;
  if (!shot.made) {
    const sideways = Number(mark.dataset.shot) % 2 === 0 ? 1 : -1;
    endX = sideways * 14;
    endY = 6;
  }

  const run = playback;
  const points = flightPoints(side, shot, endX, endY);
  // Flights sit above both halves, so they take the team color from the shot's half.
  const teamColor = mark.closest(".half").style.getPropertyValue("--made");
  const arc = svgEl("path", { class: `flight-arc ${shot.made ? "made" : "missed"}`, d: "", style: madeVar(teamColor) });
  flights.append(arc);
  let ball = null;
  let shadow = null;
  if (shot.made) {
    shadow = svgEl("ellipse", { class: "ball-shadow" });
    ball = svgEl("circle", { class: "flight-ball" });
    flights.append(shadow, ball);
  }

  const start = performance.now();
  let landed;
  const done = new Promise((resolve) => {
    landed = resolve;
  });
  const step = (now) => {
    // Cleared by a stop or Replay: nothing is waiting on this flight any more.
    if (!arc.isConnected) {
      landed();
      return;
    }

    // The arc draws behind the ball; horizontal speed is constant, like a real shot.
    // Firefox can stamp the first frame slightly before `start`, so clamp at 0.
    const u = Math.min(Math.max((now - start) / duration, 0), 1);
    const here = flightAt(points, u);
    const drawn = points.slice(0, Math.floor(u * FLIGHT_STEPS) + 1).map((p) => p.air);
    arc.setAttribute("d", pathFrom([...drawn, here.air]));
    if (ball) {
      ball.setAttribute("cx", here.air.x);
      ball.setAttribute("cy", here.air.y);
      ball.setAttribute("r", round1(7.5 * here.air.scale));
      // The shadow fades and shrinks as the ball rises.
      const lift = Math.min(here.z / 200, 1);
      const rx = round1(7 * here.ground.scale * (1 - lift * 0.4));
      shadow.setAttribute("cx", here.ground.x);
      shadow.setAttribute("cy", here.ground.y);
      shadow.setAttribute("rx", rx);
      shadow.setAttribute("ry", round1(rx * FLOOR_SQUASH));
      shadow.setAttribute("opacity", round1((0.35 - lift * 0.2) * 100) / 100);
    }
    if (u < 1) {
      requestAnimationFrame(step);
      return;
    }

    reachRim(run);
    const settle = paced(settleDuration(shot));
    arc.animate([{ opacity: 0.7 }, { opacity: 0 }], { duration: settle, fill: "forwards" })
      .finished.then(() => arc.remove(), () => {});
    if (!shot.made) {
      revealMark(mark, false, run);
      wait(settle).then(landed);
      return;
    }

    ball.remove();
    shadow.remove();
    // Swish: a ring flashes at the rim, then the make lands with a burst.
    const rim = projectHalf(side, 0, 0, RIM_HEIGHT);
    const spot = projectHalf(side, shot.x, shot.y);
    const ring = (className, p, size) => {
      const rx = round1(size * p.scale);
      const el = svgEl("ellipse", { class: className, cx: p.x, cy: p.y, rx, ry: round1(rx * FLOOR_SQUASH), style: madeVar(teamColor) });
      flights.append(el);
      return el;
    };
    ring("rim-flash", rim, 10).animate([{ opacity: 1, transform: "scale(0.6)" }, { opacity: 0, transform: "scale(2.6)" }], { duration: settle, easing: "ease-out" })
      .finished.then((a) => a.effect.target.remove(), () => {});
    ring("make-burst", spot, 10).animate([{ opacity: 0.9, transform: "scale(0.6)" }, { opacity: 0, transform: "scale(5)" }], { duration: settle, easing: "ease-out" })
      .finished.then((a) => a.effect.target.remove(), () => {});
    if (shot.type === "3PT Field Goal") {
      pulseThreePointLine(flights, side, teamColor, settle);
    }
    revealMark(mark, true, run);
    wait(settle).then(landed);
  };
  requestAnimationFrame(step);
  return done;
}

// A made three lights up the three-point line it was shot from: a copy of
// the line in the team's color flashes over it and fades, alongside the make's
// burst and for as long.
function pulseThreePointLine(flights, side, teamColor, duration) {
  const line = flights.ownerSVGElement.querySelector(`.three-point-line[data-side="${side}"]`);
  if (!line) {
    return;
  }

  const pulse = svgEl("path", { class: "three-point-pulse", d: line.getAttribute("d"), style: madeVar(teamColor) });
  flights.append(pulse);
  pulse.animate(
    [{ opacity: 1, strokeWidth: 3.5 }, { opacity: 0, strokeWidth: 12 }],
    { duration, easing: "ease-out" },
  ).finished.then(() => pulse.remove(), () => {});
}

// Clicking a shot replays its flight.
function replayShot(event) {
  const mark = event.target.closest?.(".shot");
  if (mark) {
    followPlay(mark.dataset.play);
    replayMark(mark, "shot");
  }
}

// Replays a shot's flight, unless playback is running (its shots fly one at
// a time, and a replay would cut in). `source` says what asked, for tracking.
function replayMark(mark, source) {
  if (playback?.frame || playback?.inFlight || mark.classList.contains("replaying")) {
    return;
  }

  const shot = shotsByTeam.get(mark.dataset.team)?.[Number(mark.dataset.shot)];
  track("shot_replay", {
    source,
    team_id: Number(mark.dataset.team),
    player: shot?.player,
    period: shot?.period,
    clock: shot?.clock,
    made: shot?.made,
  });
  hideTooltip();
  mark.classList.remove("revealed", "burst");
  mark.classList.add("replaying");
  launchShot(mark).then(() => {
    mark.classList.remove("replaying");
    // Outside playback a shot needs no reveal state; inside it (paused), keep it shown.
    if (!playback) {
      mark.classList.remove("revealed", "burst");
    }
  });
}

// The play-by-play sits beside the court and can be folded away to give the
// court the whole width. The choice is remembered.
let pbpCollapsed = loadPref("pbpCollapsed", false) === true;

function togglePbp(event) {
  const button = event.target.closest("#pbpToggle");
  if (!button) {
    return;
  }

  pbpCollapsed = !pbpCollapsed;
  savePref("pbpCollapsed", pbpCollapsed);
  track("pbp_toggle", { open: !pbpCollapsed });
  document.getElementById("shotLayout").classList.toggle("pbp-collapsed", pbpCollapsed);
  document.getElementById("playbyplay").hidden = pbpCollapsed;
  button.setAttribute("aria-expanded", String(!pbpCollapsed));
  if (pbpCollapsed) {
    button.title = "Show the play-by-play";
  } else {
    button.title = "Hide the play-by-play";
  }
}

// Scrolls the play-by-play (not the page) to a play and marks it as the
// current one, as playback takes each shot or a shot is clicked.
function followPlay(playId) {
  const scroller = document.getElementById("playbyplay");
  if (!scroller || pbpCollapsed || playId == null) {
    return;
  }

  for (const el of scroller.querySelectorAll("tr.current")) {
    el.classList.remove("current");
  }
  const row = scroller.querySelector(`tr[data-play="${playId}"]`);
  if (!row) {
    return;
  }

  row.classList.add("current");
  const rowBox = row.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  const top = scroller.scrollTop + rowBox.top - box.top - (scroller.clientHeight - rowBox.height) / 2;
  scroller.scrollTo({ top, behavior: "smooth" });
}

// Shots on the court and their plays in the play-by-play are linked:
// hovering either highlights the other, and clicking a play that was a shot
// or a made free throw jumps the court to that moment in the game (see
// seekToShot and seekToPlay).

function shotMarksForPlay(playId) {
  return document.querySelectorAll(`#shotcharts .shot[data-play="${playId}"]`);
}

function clearPlayLinks() {
  for (const el of boxscoreEl.querySelectorAll(".linked")) {
    el.classList.remove("linked");
  }
}

function linkPlay(event) {
  clearPlayLinks();
  const row = event.target.closest?.("#playbyplay tr[data-play]");
  if (row) {
    const marks = shotMarksForPlay(row.dataset.play);
    for (const mark of marks) {
      mark.classList.add("linked");
    }
    // Only plays with a shot on the court can be clicked.
    row.classList.toggle("has-shot", marks.length > 0);
    return;
  }

  const mark = event.target.closest?.("#shotcharts .shot[data-play]");
  if (mark) {
    document.querySelector(`#playbyplay tr[data-play="${mark.dataset.play}"]`)?.classList.add("linked");
  }
}

// How long to wait for a smooth scroll to the court before jumping, when
// the browser doesn't say it's done (no scrollend event).
const SCROLL_SETTLE_MS = 600;

// A made free throw: worth jumping to, though it isn't on the shot chart.
function isMadeFreeThrow(play) {
  return play.scored && /free throw/i.test(play.description);
}

function showPlayShot(event) {
  const row = event.target.closest("#playbyplay tr[data-play]");
  if (!row) {
    return;
  }

  const mark = shotMarksForPlay(row.dataset.play)[0];
  const play = playByPlay?.find((p) => String(p.id) === row.dataset.play);
  if (!mark && play && isMadeFreeThrow(play) && shotData) {
    if (playback?.frame) {
      track("playback", { action: "pause", playhead: playback.playhead, source: "play" });
      pausePlayback();
    }
    track("play_seek", { play_id: play.id, kind: "free_throw" });
    followPlay(play.id);
    seekToPlay(play);
    return;
  }
  if (!mark) {
    return;
  }

  for (const el of boxscoreEl.querySelectorAll(".picked")) {
    el.classList.remove("picked");
  }
  mark.classList.add("picked");
  // Clicking a play during playback pauses it there.
  if (playback?.frame) {
    track("playback", { action: "pause", playhead: playback.playhead, source: "play" });
    pausePlayback();
  }
  track("play_seek", { play_id: Number(row.dataset.play), kind: "shot" });
  followPlay(row.dataset.play);
  document.getElementById("shotchartsSection").open = true;
  const court = mark.closest(".shotchart").getBoundingClientRect();
  if (court.top >= 0 && court.bottom <= window.innerHeight) {
    seekToShot(mark);
    return;
  }

  mark.closest(".shotchart").scrollIntoView({ behavior: "smooth", block: "center" });
  let replayed = false;
  const replay = () => {
    if (!replayed) {
      replayed = true;
      seekToShot(mark);
    }
  };
  window.addEventListener("scrollend", replay, { once: true });
  setTimeout(replay, SCROLL_SETTLE_MS);
}

function clearFlights() {
  for (const flights of document.querySelectorAll("#shotcharts .flights")) {
    flights.replaceChildren();
  }
}

// Ends any playback and shows every shot again, e.g. when the quarter or game changes.
function stopPlayback() {
  if (!playback) {
    return;
  }

  cancelAnimationFrame(playback.frame);
  playback = null;
  clearFlights();
  document.getElementById("shotcharts")?.classList.remove("animating");
  const button = playButton();
  if (button) {
    button.innerHTML = PLAY_LABELS.play;
    button.setAttribute("aria-pressed", "false");
  }
  const clock = document.getElementById("playClock");
  if (clock) {
    clock.textContent = "";
  }
  for (const slot of document.querySelectorAll("#shotcharts .shooter")) {
    slot.textContent = "";
  }
  for (const row of document.querySelectorAll("#playbyplay tr.current")) {
    row.classList.remove("current");
  }
  applyTrendPlayhead();
  if (showZones) {
    drawZones();
  }
}

// Scoring trend: each team's running score over game time, as step lines
// (the score only changes at scoring plays). Follows the quarter selector.

// The chart gets taller as it gets wider (e.g. with the control panel
// collapsed), keeping roughly this shape, but never shorter than
// TREND_MIN_HEIGHT.
const TREND_MIN_HEIGHT = 260;
const TREND_ASPECT = 0.26;
const TREND_MARGIN = { top: 16, right: 72, bottom: 28, left: 40 };

// Set on each draw so hover and keyboard handlers can map back to the data.
let trend = null;

// A range dragged across the trend, in seconds since tip-off. `from` is where
// the drag started, so it can be after `to`.
let trendSelection = null;

// The drag in progress: where it started, whether Shift was held, and whether
// it has moved far enough to count as a drag rather than a click.
let trendDrag = null;

// Where the last plain click on the trend landed, in seconds since tip-off. A
// shift-click selects from here when there's no range yet.
let trendAnchor = null;

// Regulation quarters are 12 minutes; overtimes are 5.
function periodLength(period) {
  if (period <= 4) {
    return 720;
  }
  return 300;
}

function periodStart(period) {
  let total = 0;
  for (let p = 1; p < period; p++) {
    total += periodLength(p);
  }
  return total;
}

// The selected periods and their span in seconds since tip-off.
function selectedWindow() {
  let first = 1;
  let last = gamePeriods().length;
  if (selectedPeriod !== "all") {
    first = selectedPeriod;
    last = selectedPeriod;
  }
  return { first, last, t0: periodStart(first), t1: periodStart(last) + periodLength(last) };
}

// Seconds since tip-off for a play or shot whose clock reads "M:SS" remaining.
function gameSeconds(play) {
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

function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

// Lightness a team color needs to stand out on the night-mode background.
const DARK_MIN_LIGHTNESS = 0.65;

// A team color as shown in the current theme: unchanged by day; at night,
// dark colors (navy, black) are lifted to DARK_MIN_LIGHTNESS, keeping their hue.
function teamColor(hex) {
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
function trendColors() {
  const { away, home } = currentGame;
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

function drawScoreTrend() {
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
function applyTrendPlayhead() {
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
function visibleEvents() {
  if (!playback) {
    return trend.events;
  }
  return trend.events.filter((e) => e.t <= playback.playhead);
}

// Redraws at the container's width so text stays a fixed size.
// Width the chart was last drawn at (0 when skipped while collapsed).
let trendWidth = 0;
const trendObserver = new ResizeObserver(([entry]) => {
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
function trendSeries() {
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
  if (selectedPeriod !== "all") {
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

function otherSide(side) {
  if (side === "away") {
    return "home";
  }

  return "away";
}

// Win probability (a trial, toggled on the scoring trend). Hal Stern's
// random-walk model: the home margin drifts from here to the final buzzer by
// about WP_SIGMA points over a whole game, plus home-court edge, so
//   P(home wins) = Φ((margin + edge·r ± ball) / √(σ²·r + late²)),
// r = share of the game left. Having the ball is worth POSSESSION_POINTS to
// the team that has it. The late-game floor keeps the last seconds from
// looking settled: one possession can still swing the margin by 3. It doesn't
// know team strength.
let showWinProb = loadPref("winProb", false) === true;

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
const SWING_MIN = 0.2;
const SWING_MAX_SECONDS = 360;

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
function homeWinProb(score, t, ball = null) {
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
function ballSide(play) {
  if (!play.possession) {
    return null;
  }
  if (play.possession === currentGame.home.abbreviation) {
    return "home";
  }

  return "away";
}

// Who has the ball at time t: as of the last play by then.
function possessionAt(t) {
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
function pctLabel(p) {
  if (p > 0.995 && p < 1) {
    return ">99%";
  }
  if (p < 0.005 && p > 0) {
    return "<1%";
  }

  return `${Math.round(p * 100)}%`;
}

function sideWinProb(homeProb, side) {
  if (side === "home") {
    return homeProb;
  }

  return 1 - homeProb;
}

// "BOS 87% to win" for whichever team is favored.
function favoredLabel(homeProb) {
  let side = "home";
  if (homeProb < 0.5) {
    side = "away";
  }
  return `${currentGame[side].abbreviation} ${pctLabel(sideWinProb(homeProb, side))} to win`;
}

// Stretches of at most SWING_MAX_SECONDS that moved one team's win
// probability by SWING_MIN or more, shaped like scoringRuns' runs (plus wpFrom/wpTo, the home team's chance
// before and after) so the chart draws and hovers them the same way. Each
// starts and ends with a basket by the team that gained; overlapping
// candidates give way to bigger swings.
function momentumSwings() {
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
function winProbPath(series, sx, syProb) {
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

function toggleWinProb(event) {
  if (event.target.id !== "winProbToggle") {
    return;
  }

  showWinProb = event.target.checked;
  savePref("winProb", showWinProb);
  track("win_prob_toggle", { on: showWinProb });
  hideTooltip();
  drawScoreTrend();
}

// Narrowest a run block is drawn, so a quick run is still easy to hover.
const RUN_MIN_WIDTH = 6;

// A run's block on the trend, clipped to the chart's window.
function runBox(run) {
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

  const { away, home } = currentGame;
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
  trendSelection = null;
  trendAnchor = null;

  const yTicks = [];
  for (let v = yMin; v <= yMax; v += step) {
    yTicks.push(`
      <line class="grid" x1="${m.left}" x2="${m.left + plotW}" y1="${sy(v)}" y2="${sy(v)}" />
      <text class="tick" x="${m.left - 8}" y="${sy(v)}" text-anchor="end" dominant-baseline="middle">${v}</text>`);
  }

  // All quarters: a label per period with a divider between them. One quarter:
  // the time remaining every 3 minutes (every minute in overtime).
  const xTicks = [];
  if (selectedPeriod === "all") {
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
  const { away, home } = currentGame;
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
      label += ` · ${currentGame[ball].abbreviation} ball`;
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

function hideTrendPoint() {
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
  if (!trendSelection || trendSelection.from === trendSelection.to) {
    return null;
  }

  const { from, to } = trendSelection;
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
  trendSelection = null;
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

  const { away, home } = currentGame;
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
  return `<span><span class="muted">${escapeHtml(currentGame[side].abbreviation)} win probability:</span>
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
      <thead><tr><th></th><th>Start</th><th>End</th><th>Pts</th></tr></thead>
      <tbody>${row(currentGame.away, "away")}${row(currentGame.home, "home")}</tbody>
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
  const { away, home } = currentGame;
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
  const team = currentGame[swing.side];
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
  const team = currentGame[run.side];
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
function showTrendTooltip(event) {
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

function startTrendDrag(event) {
  if (event.button !== 0 || !trend || !event.target.classList?.contains("trend-hit")) {
    return;
  }

  const svg = event.target.closest("svg");
  trendDrag = { svg, startX: event.clientX - svg.getBoundingClientRect().left, shift: event.shiftKey, moved: false };
  // Keeps the drag going when the pointer leaves the chart.
  event.target.setPointerCapture(event.pointerId);
  // Stops the drag from selecting page text.
  event.preventDefault();
}

function clearTrendSelectionOnEscape(event) {
  if (event.key !== "Escape" || !trendSelection) {
    return;
  }

  clearTrendSelection();
  hideTooltip();
}

function moveTrendDrag(event) {
  if (!trendDrag) {
    return;
  }

  const x = event.clientX - trendDrag.svg.getBoundingClientRect().left;
  if (!trendDrag.moved && Math.abs(x - trendDrag.startX) < DRAG_THRESHOLD) {
    return;
  }

  trendDrag.moved = true;
  trendSelection = { from: trendTimeAt(trendDrag.startX), to: trendTimeAt(x) };
  drawTrendSelection(trendDrag.svg);
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
      trendSelection = { from: range.b, to: t };
    } else {
      trendSelection = { from: range.a, to: t };
    }
  } else if (trendAnchor != null) {
    trendSelection = { from: trendAnchor, to: t };
  } else {
    return false;
  }

  return true;
}

// A plain click clears the selection and marks where a shift-click selects
// from; a shift-click stretches or trims it.
function endTrendDrag(event) {
  if (!trendDrag) {
    return;
  }

  const { svg, moved, shift } = trendDrag;
  trendDrag = null;
  if (!moved) {
    const t = trendTimeAt(event.clientX - svg.getBoundingClientRect().left);
    if (!shift || !extendTrendSelection(t)) {
      clearTrendSelection();
      trendAnchor = t;
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
      period: selectedPeriod,
      from: trendClockLabel(range.a, false),
      to: trendClockLabel(range.b, true),
      via,
    });
  }
}

// Arrow keys step through scoring plays while the chart has focus.
function stepTrend(event) {
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

function onPointerMove(event) {
  // A drag on the trend shows its own tooltip.
  if (trendDrag?.moved) {
    return;
  }
  outlineHoveredZone(event);
  if (showShotTooltip(event) || showTrendTooltip(event) || showZoneTooltip(event)) {
    return;
  }

  hideTooltip();
  if (!event.target.closest?.(".trend svg:focus")) {
    hideTrendPoint();
  }
}

function onPointerLeave() {
  hideTooltip();
  outlineZone(document.querySelector("#shotcharts svg"), null);
  hideTrendPoint();
}

// Highlights the hovered column across a table's header, body, and footer rows.
function highlightColumn(event) {
  const cell = event.target.closest("td, th");
  const table = cell?.closest("table.stats, table.linescore");
  for (const el of boxscoreEl.querySelectorAll(".col-hover")) {
    el.classList.remove("col-hover");
  }
  // The first column holds names, not stats, so it isn't worth highlighting.
  if (!table || cell.cellIndex === 0) {
    return;
  }

  for (const row of table.rows) {
    row.cells[cell.cellIndex]?.classList.add("col-hover");
  }
}

boxscoreEl.addEventListener("mouseover", highlightColumn);
boxscoreEl.addEventListener("mouseleave", highlightColumn);
boxscoreEl.addEventListener("click", selectPeriod);
boxscoreEl.addEventListener("click", sortStats);
boxscoreEl.addEventListener("click", togglePlayback);
boxscoreEl.addEventListener("click", cycleSpeed);
document.addEventListener("keydown", gameShortcuts);
boxscoreEl.addEventListener("click", replayShot);
boxscoreEl.addEventListener("click", showPlayShot);
boxscoreEl.addEventListener("click", togglePbp);
boxscoreEl.addEventListener("click", openPlayerCard);
playerDialog.addEventListener("click", playerCardClick);
playerDialog.addEventListener("mouseover", outlineCardZone);
playerDialog.addEventListener("mouseleave", () => outlineZone(playerDialog.querySelector(".card-court"), null));
playerDialog.addEventListener("change", playerCardChange);
playerDialog.addEventListener("close", () => {
  playerCard = null;
});
// toggle doesn't bubble, so listen while it travels down.
boxscoreEl.addEventListener("toggle", rememberSection, true);
boxscoreEl.addEventListener("mouseover", linkPlay);
boxscoreEl.addEventListener("mouseleave", clearPlayLinks);
boxscoreEl.addEventListener("click", playerMenuClick);
boxscoreEl.addEventListener("change", playerMenuChange);
boxscoreEl.addEventListener("change", toggleCourtTrend);
boxscoreEl.addEventListener("change", toggleZones);
boxscoreEl.addEventListener("change", toggleWinProb);
document.addEventListener("click", closePlayerMenu);
document.addEventListener("keydown", closePlayerMenu);
boxscoreEl.addEventListener("mousemove", onPointerMove);
boxscoreEl.addEventListener("mouseleave", onPointerLeave);
boxscoreEl.addEventListener("keydown", stepTrend);
boxscoreEl.addEventListener("pointerdown", startTrendDrag);
boxscoreEl.addEventListener("pointermove", moveTrendDrag);
boxscoreEl.addEventListener("pointerup", endTrendDrag);
boxscoreEl.addEventListener("pointercancel", endTrendDrag);
document.addEventListener("keydown", clearTrendSelectionOnEscape);
boxscoreEl.addEventListener("focusout", onPointerLeave);
// Day/night mode. index.html sets the starting theme before first paint; the
// bulb switches it and remembers the choice. Until there's a choice, the page
// follows the system setting.
const themeToggle = document.getElementById("themeToggle");
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function syncThemeToggle() {
  const dark = isDark();
  themeToggle.setAttribute("aria-pressed", String(dark));
  if (dark) {
    themeToggle.title = "Switch to day mode";
  } else {
    themeToggle.title = "Switch to night mode";
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  syncThemeToggle();
  // Team colors are baked into the charts' markup, so recolor them. The shot
  // charts are recolored in place rather than redrawn, so playback continues.
  if (!currentGame) {
    return;
  }

  hideTooltip();
  applyScoreColors();
  if (shotData) {
    recolorShotCharts();
  }
  if (playByPlay) {
    document.getElementById("playbyplay").innerHTML = renderPlayByPlay();
    drawScoreTrend();
  }
}

themeToggle.addEventListener("click", () => {
  let theme = "dark";
  if (isDark()) {
    theme = "light";
  }
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // Private windows can refuse storage; the switch still works for this visit.
  }
  track("theme_toggle", { theme });
  applyTheme(theme);
});

systemDark.addEventListener("change", (event) => {
  let saved = null;
  try {
    saved = localStorage.getItem("theme");
  } catch {
    // No storage: keep following the system.
  }
  if (!saved) {
    if (event.matches) {
      applyTheme("dark");
    } else {
      applyTheme("light");
    }
  }
});

syncThemeToggle();

// Collapsing the control panel. index.html applies a saved choice before
// first paint; this keeps the button in step and remembers changes.
const panelToggle = document.getElementById("panelToggle");

function syncPanelToggle() {
  const collapsed = document.documentElement.dataset.panel === "collapsed";
  panelToggle.setAttribute("aria-expanded", String(!collapsed));
  if (collapsed) {
    panelToggle.title = "Show controls";
  } else {
    panelToggle.title = "Hide controls";
  }
}

panelToggle.addEventListener("click", () => {
  const collapse = document.documentElement.dataset.panel !== "collapsed";
  if (collapse) {
    document.documentElement.dataset.panel = "collapsed";
  } else {
    delete document.documentElement.dataset.panel;
  }
  try {
    if (collapse) {
      localStorage.setItem("panel", "collapsed");
    } else {
      localStorage.removeItem("panel");
    }
  } catch {
    // Private windows can refuse storage; the panel still folds for this visit.
  }
  track("panel_toggle", { open: !collapse });
  syncPanelToggle();
});

syncPanelToggle();

// The page's state lives in the URL hash so any view can be bookmarked or
// shared, e.g. #team=BOS&season=2024&date=2024-10-22&q=OT1&players=1628369,1627759.
function writeHash() {
  const params = new URLSearchParams();
  const abbr = teamSelect.selectedOptions[0]?.dataset.abbr;
  if (abbr) {
    params.set("team", abbr);
    params.set("season", seasonSelect.value);
    if (currentDate) {
      params.set("date", currentDate);
      if (selectedPeriod !== "all") {
        params.set("q", periodLabel(selectedPeriod));
      }
      if (selectedPlayers.size > 0) {
        params.set("players", [...selectedPlayers].join(","));
      }
    }
  }

  // replaceState updates the URL without adding history entries or firing hashchange.
  // Commas are fine in a fragment, so keep the player list readable.
  const hash = params.toString().replaceAll("%2C", ",");
  savePref("lastView", hash);
  if (hash) {
    history.replaceState(null, "", `#${hash}`);
  } else {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

// "Q2" -> 2, "OT1" -> 5; anything else means every quarter.
function periodFromLabel(label) {
  const match = /^(Q|OT)(\d+)$/i.exec(label ?? "");
  if (!match) {
    return "all";
  }

  const n = Number(match[2]);
  if (match[1].toUpperCase() === "Q") {
    if (n >= 1 && n <= 4) {
      return n;
    }
    return "all";
  }
  return 4 + n;
}

// Picked players from "players=1,2,3". Older links repeated "player=" per
// player instead; those still work and get rewritten in the new form.
function playersFromHash(params) {
  const list = (params.get("players") ?? "").split(",");
  return [...list, ...params.getAll("player")].filter(Boolean);
}

// Restores the form and game from the hash. Invalid values are dropped and the
// hash rewritten to match what's actually shown.
async function applyHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const abbr = params.get("team")?.toUpperCase();
  const team = [...teamSelect.options].find((o) => o.dataset.abbr && o.dataset.abbr === abbr);
  const season = params.get("season");
  if ([...seasonSelect.options].some((o) => o.value === season)) {
    seasonSelect.value = season;
  }
  teamSelect.value = team?.value ?? "";

  await loadGames();
  const date = params.get("date");
  if (gameIdsByDate.has(date)) {
    calendar.setDate(date, false);
    jumpCalendar(date);
    await loadBoxScore(date, periodFromLabel(params.get("q")), playersFromHash(params));
    return;
  }

  writeHash();
}

teamSelect.addEventListener("change", () => {
  track("team_select", { team_id: teamSelect.value, team: teamSelect.selectedOptions[0]?.dataset.abbr });
  loadGames();
});
seasonSelect.addEventListener("change", () => {
  track("season_select", { season: seasonSelect.value });
  loadGames();
});
// Collapsing or expanding a team's box score or a game section. Tracked from
// the summary click (Enter and Space click it too) since details also fires
// toggle when rendered open.
boxscoreEl.addEventListener("click", (event) => {
  const details = event.target.closest("details.collapsible > summary")?.parentElement;
  if (!details) {
    return;
  }

  if (details.dataset.team) {
    track("box_score_toggle", { team_id: Number(details.dataset.team), open: !details.open });
  } else {
    track("section_toggle", { section: details.dataset.section, open: !details.open });
  }
});
// Editing the URL by hand, or back/forward between hashes.
window.addEventListener("hashchange", () => {
  track("hash_change", { hash: location.hash });
  applyHash();
});

loadSeasons();
// A visit without a link picks up where the last one left off.
if (!location.hash) {
  const lastView = loadPref("lastView", "");
  if (typeof lastView === "string" && lastView) {
    history.replaceState(null, "", `#${lastView}`);
  }
}
Promise.all([loadTeams(), loadInfo()]).then(applyHash);
