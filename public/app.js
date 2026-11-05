// The page's entry point: wires the page's events to the modules in ui/,
// handles the game's keyboard shortcuts and hovering, and loads the view in
// the URL (or the last one seen).
import { loadPref } from "./lib/prefs.js";
import { showBigPlay } from "./ui/bigplays.js";
import { rememberSection, sortStats } from "./ui/boxscore.js";
import { cardSortClick } from "./ui/cardsort.js";
import { highlightCardZone, outlineCardZone } from "./ui/cardzones.js";
import { boxscoreEl, seasonSelect, teamSelect } from "./ui/dom.js";
import { closePlayerMenu, gamePeriods, playerMenuChange, playerMenuClick, selectPeriod, showPeriod } from "./ui/filters.js";
import { replayShot } from "./ui/flights.js";
import { loadGames, loadInfo, loadSeasons, loadTeams } from "./ui/games.js";
import { applyHash, cardClosed } from "./ui/hash.js";
import { toggleLineups } from "./ui/lineups.js";
import { clearPlayLinks, linkPlay, showPlayShot, togglePbp } from "./ui/pbp.js";
import { cycleSpeed, playButton, togglePlayback } from "./ui/playback.js";
import { openPlayerCard, playerCardChange, playerCardClick, playerDialog } from "./ui/playercard.js";
import { showShotTooltip, toggleCourtTrend } from "./ui/shotchart.js";
import { state } from "./ui/state.js";
import { openTeamCard, teamCardClick, teamCardClosed, teamDialog } from "./ui/teamcard.js";
// Sets up the player search box.
import "./ui/search.js";
// Sets up the day/night and control panel switches.
import "./ui/theme.js";
import { hideTooltip } from "./ui/tooltip.js";
import { clearTrendSelectionOnEscape, endTrendDrag, hideTrendPoint, moveTrendDrag, showTrendTooltip, startTrendDrag, stepTrend } from "./ui/trend-hover.js";
import { toggleWinProb } from "./ui/winprob.js";
import { outlineHoveredZone, outlineZone, showZoneTooltip, toggleZones } from "./ui/zones.js";

// Keyboard shortcuts for the game: Space plays or pauses, and the left and
// right arrows step through the quarter tabs. They stay out of the way of
// anything that takes those keys itself: form fields, the player menu, the
// focusable scoring trend (its arrows step through plays), and the control
// panel. Space on a focused button already clicks it.
function gameShortcuts(event) {
  if (!state.currentGame || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }
  if (playerDialog.open || teamDialog.open || event.target.closest("input, select, textarea, [tabindex], .panel, .player-menu")) {
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
  const next = options[options.indexOf(state.selectedPeriod) + step];
  if (next !== undefined) {
    event.preventDefault();
    showPeriod(next, "keyboard");
  }
}

function onPointerMove(event) {
  // A drag on the trend shows its own tooltip.
  if (state.trendDrag?.moved) {
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
boxscoreEl.addEventListener("click", openTeamCard);
boxscoreEl.addEventListener("click", cardSortClick);
boxscoreEl.addEventListener("click", toggleLineups);
boxscoreEl.addEventListener("click", showBigPlay);
playerDialog.addEventListener("click", playerCardClick);
playerDialog.addEventListener("mouseover", outlineCardZone);
playerDialog.addEventListener("mouseleave", () => highlightCardZone(playerDialog, null));
playerDialog.addEventListener("change", playerCardChange);
playerDialog.addEventListener("close", () => {
  const id = state.playerCard?.id;
  state.playerCard = null;
  cardClosed("player", id);
});
teamDialog.addEventListener("click", teamCardClick);
teamDialog.addEventListener("mouseover", outlineCardZone);
teamDialog.addEventListener("mouseleave", () => highlightCardZone(teamDialog, null));
teamDialog.addEventListener("close", teamCardClosed);
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
Promise.all([
  loadTeams(),
  loadInfo(),
]).then(applyHash);
