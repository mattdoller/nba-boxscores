// The page's state in the URL hash, so any view can be bookmarked or
// shared.
import { periodLabel } from "../lib/format.js";
import { savePref } from "../lib/prefs.js";
import { seasonSelect, teamSelect } from "./dom.js";
import { calendar, currentDate, gameIdsByDate, jumpCalendar, loadBoxScore, loadGames } from "./games.js";
import { loadPlayerZones, playerDialog, showPlayerCard } from "./playercard.js";
import { state } from "./state.js";
import { showTeamCard, teamDialog } from "./teamcard.js";

// The page's state lives in the URL hash so any view can be bookmarked or
// shared, e.g. #team=BOS&season=2024&date=2024-10-22&q=OT1&players=1628369,1627759.
// An open card adds card=player:<id> (with zones=<season>, the season of
// zones it shows) or card=team:<id>.

// The view without any card: the team, season, game, quarter, and players.
function viewParams() {
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
  return params;
}

// Commas and colons are fine in a fragment, so keep the player list and
// card readable.
function hashOf(params) {
  return params.toString().replaceAll("%2C", ",").replaceAll("%3A", ":");
}

// Writes what's on screen to the hash. Updates replace the current history
// entry without firing hashchange, except opening a card, which `push`es a
// new one so Back closes the card. A return visit picks up the view, but
// not a card left open.
export function writeHash({ push = false } = {}) {
  const params = viewParams();
  savePref("lastView", hashOf(params));
  if (state.playerCard) {
    params.set("card", `player:${state.playerCard.id}`);
    if (state.playerCard.season) {
      params.set("zones", state.playerCard.season);
    }
  } else if (state.teamCard) {
    params.set("card", `team:${state.teamCard.id}`);
  }

  let url = location.pathname + location.search;
  if (params.size > 0) {
    url = `#${hashOf(params)}`;
  }
  if (push) {
    // Marks the entry as a card's, so closing the card can go back to the
    // entry before it rather than add another.
    history.pushState({ card: true }, "", url);
  } else {
    history.replaceState(history.state, "", url);
  }
}

// After the user closes a card (its × or backdrop, or Escape): take it out
// of the URL. A card opened with its own history entry goes back to the
// entry before; one opened from a link just drops the parameter. Nothing to
// do when the URL had already moved on, as when Back closed the card or a
// link switched cards.
export function cardClosed(kind, id) {
  if (id == null || new URLSearchParams(location.hash.slice(1)).get("card") !== `${kind}:${id}`) {
    return;
  }
  if (history.state?.card) {
    history.back();
  } else {
    writeHash();
  }
}

// Shows another view in place of the current one (and any card), as if its
// link were followed, but without adding to the history.
export function openView(hash) {
  history.replaceState(null, "", `#${hash}`);
  closePlayerCard();
  closeTeamCard();
  applyHash();
}

// Closes a card to match the URL. Its state goes first, so its close event
// doesn't take it out of the URL again (see cardClosed).
function closePlayerCard() {
  state.playerCard = null;
  playerDialog.close();
}

function closeTeamCard() {
  state.teamCard = null;
  teamDialog.close();
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

// Opens, switches, or closes the card to match the hash, once its game is
// on screen. A card that can't be opened, like a player who isn't in the
// game, is dropped from the hash.
function syncCard(params) {
  const [kind, id] = (params.get("card") ?? "").split(":");
  const zones = Number(params.get("zones")) || null;
  if (kind === "player" && id) {
    closeTeamCard();
    if (state.playerCard?.id === id) {
      if (zones && zones !== state.playerCard.season && state.playerCard.career) {
        loadPlayerZones(zones);
      }
      return;
    }
    if (!showPlayerCard(id, zones, "link")) {
      closePlayerCard();
    }
    // Loading the game rewrote the hash before the card opened.
    writeHash();
    return;
  }
  if (kind === "team" && id) {
    closePlayerCard();
    if (String(state.teamCard?.id) === id) {
      return;
    }
    if (!showTeamCard(id, "link")) {
      closeTeamCard();
    }
    writeHash();
    return;
  }

  closePlayerCard();
  closeTeamCard();
  if (params.has("card")) {
    writeHash();
  }
}

// What a hash shows apart from any card, for telling when only the card
// changed.
function viewKey(params) {
  return ["team", "season", "date", "q", "players"].map((key) => params.get(key) ?? "").join("|").toUpperCase();
}

// Restores the form and game from the hash, and any card. Invalid values are
// dropped and the hash rewritten to match what's actually shown. When only
// the card changed, as with Back from a card, the game stays as it is.
export async function applyHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (state.currentGame && viewKey(params) === viewKey(viewParams())) {
    syncCard(params);
    return;
  }

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
    if (state.currentGame) {
      syncCard(params);
    }
    return;
  }

  closePlayerCard();
  closeTeamCard();
  writeHash();
}
