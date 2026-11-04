// The page's state in the URL hash, so any view can be bookmarked or
// shared.
import { periodLabel } from "../lib/format.js";
import { savePref } from "../lib/prefs.js";
import { seasonSelect, teamSelect } from "./dom.js";
import { calendar, currentDate, gameIdsByDate, jumpCalendar, loadBoxScore, loadGames } from "./games.js";
import { state } from "./state.js";

// The page's state lives in the URL hash so any view can be bookmarked or
// shared, e.g. #team=BOS&season=2024&date=2024-10-22&q=OT1&players=1628369,1627759.
export function writeHash() {
  const params = new URLSearchParams();
  const abbr = teamSelect.selectedOptions[0]?.dataset.abbr;
  if (abbr) {
    params.set("team", abbr);
    params.set("season", seasonSelect.value);
    if (currentDate) {
      params.set("date", currentDate);
      if (state.selectedPeriod !== "all") {
        params.set("q", periodLabel(state.selectedPeriod));
      }
      if (state.selectedPlayers.size > 0) {
        params.set("players", [...state.selectedPlayers].join(","));
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
export async function applyHash() {
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
