// The header's two switches: day or night mode, and folding away the
// control panel.
import { applyScoreColors } from "./boxscore.js";
import { playByPlay, shotData } from "./games.js";
import { renderPlayByPlay } from "./pbp.js";
import { recolorShotCharts } from "./shotchart.js";
import { state } from "./state.js";
import { hideTooltip } from "./tooltip.js";
import { drawScoreTrend, isDark } from "./trend.js";

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
  if (!state.currentGame) {
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
