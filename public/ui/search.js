// Finding a player by name, from the control panel: matches as you type,
// from every player who has played in the league (/api/players), and
// picking one opens their card. The list is fetched the first time it's
// needed.
import { escapeHtml } from "../lib/format.js";
import { getJson } from "./api.js";
import { writeHash } from "./hash.js";
import { showPlayerCard } from "./playercard.js";

const input = document.getElementById("playerSearch");
const results = document.getElementById("playerResults");

const RESULTS_SHOWN = 8;

// The player list, once fetched: a promise, so asking twice fetches once.
let directory = null;

export function loadDirectory() {
  // A failed fetch isn't kept, so the next try fetches again.
  directory ??= getJson("/api/players").catch((err) => {
    directory = null;
    throw err;
  });
  return directory;
}

// A player from the list, by id, or undefined.
export async function directoryPlayer(id) {
  const players = await loadDirectory();
  return players.find((p) => String(p.id) === String(id));
}

// Names compared without accents or case, so "jokic" finds Jokić.
function plain(text) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

// Players whose names have a word starting with each word typed, best
// first: whole-name prefixes, then current players, then the most recent.
function matches(players, query) {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const typed = plain(query.trim());
  return players
    .filter((p) => {
      const parts = plain(p.name).split(/[\s-]+/);
      return words.every((word) => parts.some((part) => part.startsWith(word)));
    })
    .map((p) => ({ p, prefix: plain(p.name).startsWith(typed) ? 0 : 1, active: p.team ? 0 : 1 }))
    .sort((a, b) => a.prefix - b.prefix || a.active - b.active || b.p.to - a.p.to || a.p.name.localeCompare(b.p.name))
    .slice(0, RESULTS_SHOWN)
    .map(({ p }) => p);
}

// "BOS · 2018–2026", or the years alone for someone not on a team.
function about(p) {
  const years = p.from === p.to ? `${p.from}` : `${p.from}–${p.to}`;
  return [p.team, years].filter(Boolean).join(" · ");
}

let shown = [];
let active = -1;

function render() {
  results.innerHTML = shown.map((p, i) => `
    <li role="option" id="playerResult${i}" data-player="${p.id}" aria-selected="${i === active}">
      <span class="result-name">${escapeHtml(p.name)}</span>
      <span class="result-about">${escapeHtml(about(p))}</span>
    </li>`).join("");
  results.hidden = shown.length === 0 && !results.dataset.message;
  if (results.dataset.message) {
    results.innerHTML = `<li class="result-message">${escapeHtml(results.dataset.message)}</li>`;
  }
  input.setAttribute("aria-expanded", String(!results.hidden));
  if (active >= 0) {
    input.setAttribute("aria-activedescendant", `playerResult${active}`);
  } else {
    input.removeAttribute("aria-activedescendant");
  }
}

function close() {
  shown = [];
  active = -1;
  delete results.dataset.message;
  render();
}

async function update() {
  const query = input.value;
  if (!query.trim()) {
    close();
    return;
  }
  let players;
  try {
    players = await loadDirectory();
  } catch (err) {
    shown = [];
    results.dataset.message = err.message;
    render();
    return;
  }
  // The box may have changed while the list loaded.
  if (input.value !== query) {
    return;
  }
  shown = matches(players, query);
  active = shown.length > 0 ? 0 : -1;
  if (shown.length === 0) {
    results.dataset.message = "No players by that name.";
  } else {
    delete results.dataset.message;
  }
  render();
}

// Opens the card of the player picked, adding it to the history like a card
// opened from a box score.
function pick(player) {
  track("player_search", { player_id: player.id, query: input.value });
  input.value = "";
  close();
  input.blur();
  showPlayerCard(player.id, null, "search", player);
  writeHash({ push: true });
}

input.addEventListener("focus", () => {
  // Start fetching the list now, so it's ready by the first letter.
  loadDirectory().catch(() => {});
});
input.addEventListener("input", update);
input.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (shown.length === 0) {
      return;
    }
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    active = (active + step + shown.length) % shown.length;
    render();
  } else if (event.key === "Enter" && active >= 0) {
    event.preventDefault();
    pick(shown[active]);
  } else if (event.key === "Escape") {
    input.value = "";
    close();
  }
});
// mousedown, before the box loses focus and the list closes.
results.addEventListener("mousedown", (event) => {
  const item = event.target.closest("[data-player]");
  if (item) {
    event.preventDefault();
    pick(shown.find((p) => String(p.id) === item.dataset.player));
  }
});
input.addEventListener("blur", close);
