// The quarter tabs and player menu that filter the shot charts,
// play-by-play, and scoring trend.
import { escapeHtml, periodLabel } from "../lib/format.js";
import { playByPlay, shotData } from "./games.js";
import { writeHash } from "./hash.js";
import { renderPlayByPlay } from "./pbp.js";
import { stopPlayback } from "./playback.js";
import { renderShotCharts } from "./shotchart.js";
import { state } from "./state.js";
import { hideTooltip } from "./tooltip.js";
import { drawScoreTrend } from "./trend.js";

// Every period the game had, from the line score, shots, and plays. The line
// score can be missing, so overtimes may only show up once the others load.
export function gamePeriods() {
  const { home, away } = state.currentGame;
  const seen = [
    ...Object.values(shotData ?? {}).flat(),
    ...(playByPlay ?? []),
  ].map((item) => item.period);
  const count = Math.max(home.periods.length, away.periods.length, 4, ...seen);
  return Array.from({ length: count }, (_, i) => i + 1);
}

export function refreshPeriodTabs() {
  const tabs = document.getElementById("periodTabs");
  if (tabs) {
    tabs.innerHTML = renderPeriodTabs();
  }
}

export function inSelectedPeriod(item) {
  return state.selectedPeriod === "all" || item.period === state.selectedPeriod;
}

export function renderPeriodTabs() {
  const options = [["all", "All"], ...gamePeriods().map((p) => [p, periodLabel(p)])];
  return options.map(([value, label]) => `
    <button type="button" data-period="${value}" aria-pressed="${value === state.selectedPeriod}"
      class="${value === state.selectedPeriod ? "active" : ""}">${escapeHtml(label)}</button>`)
    .join("");
}

// Identifies a shooter: their stats.nba.com id, or their name if the server
// didn't send ids (an older server). Always a string, as in the URL.
export function playerKey(shot) {
  return String(shot.player_id ?? shot.player);
}

// Everyone who took a shot in the game, by team: [[team, [{ id, name }]], ...].
export function shooters() {
  const { away, home } = state.currentGame;
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
export function wholeTeamPicked(players) {
  return players.length > 0 && players.every((p) => state.selectedPlayers.has(p.id));
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
  return shooters().flatMap(([, players]) => players).filter((p) => state.selectedPlayers.has(p.id));
}

// Builds the checkbox menu of shooters, grouped by team. Players from the URL
// who didn't shoot in this game are dropped.
export function fillPlayerMenu() {
  const groups = shooters();
  const known = new Set(groups.flatMap(([, players]) => players.map((p) => p.id)));
  const kept = new Set([...state.selectedPlayers].filter((id) => known.has(id)));
  if (kept.size !== state.selectedPlayers.size) {
    state.selectedPlayers = kept;
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
          <label><input type="checkbox" value="${escapeHtml(p.id)}"${state.selectedPlayers.has(p.id) ? " checked" : ""}> ${escapeHtml(p.name)}</label>`).join("")}
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
  state.selectedPlayers = players;
  stopPlayback();
  hideTooltip();
  writeHash();
  updatePlayerButton();
  document.getElementById("shotcharts").innerHTML = renderShotCharts();
}

// Opens and closes the menu, and handles "Show all".
export function playerMenuClick(event) {
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

export function playerMenuChange(event) {
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
export function closePlayerMenu(event) {
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

export function selectPeriod(event) {
  const button = event.target.closest("#periodTabs button");
  if (!button) {
    return;
  }

  showPeriod(button.dataset.period === "all" ? "all" : Number(button.dataset.period), "tab");
}

// Filters the charts and play-by-play to a quarter ("all" for the whole
// game). `source` says how it was picked, for tracking.
export function showPeriod(period, source) {
  state.selectedPeriod = period;
  track("period_select", { period: state.selectedPeriod, source });
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
