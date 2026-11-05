// The team card: a modal over the game with a team's regular season so far,
// opened from its name on the scoreboard. Its record, its stats ranked
// against the league's and shaded like the player card's, every game it has
// played, and its hot/cold zones.
import { escapeHtml } from "../lib/format.js";
import { getJson } from "./api.js";
import { applyCardSorts, cardSortClick, sortHeader } from "./cardsort.js";
import { percent, seasonLabel, shadeAttrs, zonesBody } from "./cardzones.js";
import { seasonSelect, teamSelect } from "./dom.js";
import { cardClosed, openView, writeHash } from "./hash.js";
import { state } from "./state.js";
import { hideTooltip } from "./tooltip.js";

export const teamDialog = document.getElementById("teamDialog");

// A stat in the season table. `value` works it out from a team's season
// totals. Counting stats compare per game with the league's average team
// (`total`, the totals key), percentages with the league's (`share`), and
// the point differential with zero. `worse` marks stats where more is bad,
// ranked and shaded the other way.
const perGameOf = (key) => (t) => t[key] / t.gp;
const shareOf = (made, attempts) => (t) => t[made] / t[attempts];

const TEAM_STATS = [
  { label: "Points", value: perGameOf("pts"), total: "pts" },
  { label: "Points allowed", value: perGameOf("opp_pts"), total: "opp_pts", worse: true },
  { label: "Point differential", value: (t) => (t.pts - t.opp_pts) / t.gp, differential: true },
  { label: "FG%", value: shareOf("fgm", "fga"), share: ["fgm", "fga"] },
  { label: "3-pointers made", value: perGameOf("fg3m"), total: "fg3m" },
  { label: "3P%", value: shareOf("fg3m", "fg3a"), share: ["fg3m", "fg3a"] },
  { label: "FT%", value: shareOf("ftm", "fta"), share: ["ftm", "fta"] },
  { label: "Rebounds", value: perGameOf("reb"), total: "reb" },
  { label: "Offensive rebounds", value: perGameOf("oreb"), total: "oreb" },
  { label: "Assists", value: perGameOf("ast"), total: "ast" },
  { label: "Turnovers", value: perGameOf("tov"), total: "tov", worse: true },
  { label: "Steals", value: perGameOf("stl"), total: "stl" },
  { label: "Blocks", value: perGameOf("blk"), total: "blk" },
  { label: "Fouls", value: perGameOf("pf"), total: "pf", worse: true },
];

// Teams differ less than players, so shades reach full strength sooner: a
// per-game stat this far off the league's average (as a fraction of it), a
// percentage this many points off, a differential this many points a game.
const SHADE_FULL_SHARE_OF_AVERAGE = 0.15;
const SHADE_FULL_POINTS = 0.04;
const SHADE_FULL_DIFFERENTIAL = 10;

// The league's average team: per game for counting stats, over every
// attempt for percentages.
function leagueValue(stat, teams) {
  const sum = (key) => teams.reduce((total, t) => total + t[key], 0);
  if (stat.differential) {
    return 0;
  }
  if (stat.share) {
    return sum(stat.share[0]) / sum(stat.share[1]);
  }
  return sum(stat.total) / sum("gp");
}

// 1 for the best team in the league at a stat; tied teams share a rank.
function rankOf(stat, own, teams) {
  const values = teams.filter((t) => t.gp > 0).map((t) => stat.value(t));
  const ahead = values.filter((v) => (stat.worse ? v < own : v > own)).length;
  return ahead + 1;
}

function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) {
    return `${n}th`;
  }
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

function formatStat(stat, value) {
  if (stat.share) {
    return percent(value, 1);
  }
  if (stat.differential) {
    return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
  }
  return value.toFixed(1);
}

function statShade(stat, own, league) {
  let strength;
  let better;
  if (stat.differential) {
    strength = Math.min(Math.abs(own) / SHADE_FULL_DIFFERENTIAL, 1);
    better = own > 0;
  } else if (stat.share) {
    strength = Math.min(Math.abs(own - league) / SHADE_FULL_POINTS, 1);
    better = own > league;
  } else {
    strength = Math.min(Math.abs(own / league - 1) / SHADE_FULL_SHARE_OF_AVERAGE, 1);
    better = own > league;
  }
  if (stat.worse) {
    better = !better;
  }
  return shadeAttrs(better, strength, `League average ${formatStat(stat, league)}`);
}

function statsTable(data) {
  const own = data.teams.find((t) => t.team_id === data.team.id);
  if (!own?.gp) {
    return '<p class="hint">No games played yet this season.</p>';
  }

  const rows = TEAM_STATS.map((stat) => {
    const value = stat.value(own);
    const league = leagueValue(stat, data.teams);
    return `
      <tr>
        <th>${escapeHtml(stat.label)}</th>
        <td${statShade(stat, value, league)}>${formatStat(stat, value)}</td>
        <td>${ordinal(rankOf(stat, value, data.teams))}</td>
        <td>${formatStat(stat, league)}</td>
      </tr>`;
  }).join("");
  return `
    <div class="table-wrap">
      <table class="stats team-stats-table" data-sort-table="team-stats">
        <thead>
          <tr>${sortHeader("Per game", { text: true })}${sortHeader("Team")}${sortHeader("Rank", { ascending: true })}${sortHeader("League")}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// The record after each game, oldest first: ["1–0", "1–1", ...].
function runningRecords(games) {
  let w = 0;
  let l = 0;
  return games.map((g) => {
    if (g.result === "W") {
      w++;
    } else {
      l++;
    }
    return `${w}–${l}`;
  });
}

function recordOf(games) {
  const w = games.filter((g) => g.result === "W").length;
  return `${w}–${games.length - w}`;
}

// "W3" for three wins in a row, as of the last game.
function streakOf(games) {
  const last = games.at(-1);
  if (!last) {
    return "";
  }
  let length = 0;
  for (let i = games.length - 1; i >= 0 && games[i].result === last.result; i--) {
    length++;
  }
  return `${last.result}${length}`;
}

function shortDate(date) {
  return new Date(`${date}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// The record, home and away, streak, and last ten, and where the team stood
// after the game on screen when it's one of theirs.
function recordLine(data) {
  const { games } = data;
  const parts = [
    `<strong>${recordOf(games)}</strong>`,
    `Home ${recordOf(games.filter((g) => g.home))}`,
    `Away ${recordOf(games.filter((g) => !g.home))}`,
  ];
  if (games.length > 0) {
    parts.push(`Streak ${streakOf(games)}`, `Last 10 ${recordOf(games.slice(-10))}`);
  }
  const index = games.findIndex((g) => g.id === state.currentGame?.id);
  if (index !== -1 && index < games.length - 1) {
    parts.push(`${runningRecords(games)[index]} after this game`);
  }
  return `<p class="team-record">${parts.map((part) => `<span class="phrase">${part}</span>`).join(" · ")}</p>`;
}

function gameLog(data) {
  if (data.games.length === 0) {
    return '<p class="hint">No games played yet this season.</p>';
  }

  const records = runningRecords(data.games);
  const rows = data.games.map((g, i) => {
    const current = g.id === state.currentGame?.id;
    return `
      <tr data-date="${g.date}" class="${current ? "current" : ""}" title="Open this game">
        <td>${escapeHtml(shortDate(g.date))}</td>
        <td class="text">${g.home ? "vs" : "@"} ${escapeHtml(g.opponent)}</td>
        <td class="text result ${g.result === "W" ? "win" : "loss"}">${escapeHtml(g.result)} ${g.pts}–${g.opp_pts}</td>
        <td>${records[i]}</td>
      </tr>`;
  }).join("");
  return `
    <div class="table-wrap team-games">
      <table class="stats team-game-log">
        <thead><tr><th>Date</th><th class="text">Opponent</th><th class="text">Result</th><th>Record</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderTeamCard() {
  if (!state.teamCard) {
    return;
  }

  const { name, season, data, error } = state.teamCard;
  let body = '<p class="hint">Loading the season…</p>';
  if (error) {
    body = `<p class="notice">${escapeHtml(error)}</p>`;
  } else if (data) {
    body = `
      ${recordLine(data)}
      <div class="team-card-columns">
        <section>
          <h3>Season</h3>
          ${statsTable(data)}
        </section>
        <section>
          <h3>Games</h3>
          ${gameLog(data)}
        </section>
      </div>`;
  }
  teamDialog.innerHTML = `
    <div class="player-card">
      <header class="player-card-header">
        <div>
          <h2 id="teamDialogTitle">${escapeHtml(name)}</h2>
          <p class="player-card-about">${seasonLabel(season)} regular season</p>
        </div>
        <button type="button" class="player-card-close" aria-label="Close">×</button>
      </header>
      ${body}
      <section class="card-zones">
        <div class="card-zones-head"><h3>Hot/cold zones</h3></div>
        ${zonesBody(state.teamCard.zones, `${name}'s shooting by zone`, "team")}
      </section>
    </div>`;
  applyCardSorts(teamDialog);
  // The game on screen, scrolled into view in the game log.
  teamDialog.querySelector(".team-game-log tr.current")?.scrollIntoView({ block: "center" });
}

// Opening from a team's name on the scoreboard adds the card to the
// browser's history, so Back closes it.
export function openTeamCard(event) {
  const button = event.target.closest(".team-link");
  if (!button) {
    return;
  }

  showTeamCard(button.dataset.team, "scoreboard");
  writeHash({ push: true });
}

// Opens a team's card, by id, for the season on screen: from the scoreboard
// or from a link (see syncCard in hash.js). Returns false for an unknown
// team.
export function showTeamCard(id, source) {
  const option = [...teamSelect.options].find((o) => o.value && o.value === String(id));
  if (!option) {
    return false;
  }

  const card = {
    id: Number(id),
    name: option.textContent,
    season: Number(seasonSelect.value),
    data: null,
    error: null,
    zones: "loading",
  };
  state.teamCard = card;
  track("team_card_open", { team_id: card.id, season: card.season, source });
  hideTooltip();
  renderTeamCard();
  if (!teamDialog.open) {
    teamDialog.showModal();
  }
  loadTeamCard(card);
  return true;
}

async function loadTeamCard(card) {
  const query = `team_id=${card.id}&season=${card.season}`;
  await Promise.all([
    getJson(`/api/team?${query}`).then((data) => {
      card.data = data;
    }, (err) => {
      card.error = err.message;
    }),
    getJson(`/api/teamzones?${query}`).then((zones) => {
      card.zones = zones;
    }, (err) => {
      card.zones = err;
    }),
  ].map((loaded) => loaded.then(() => {
    if (card === state.teamCard) {
      renderTeamCard();
    }
  })));
}

export function teamCardClick(event) {
  if (cardSortClick(event)) {
    return;
  }
  // A click on the backdrop lands on the dialog itself.
  if (event.target === teamDialog || event.target.closest(".player-card-close")) {
    teamDialog.close();
    return;
  }

  // A game in the log opens it, in place of the game on screen and the card
  // (so Back goes to the game before, not to the card).
  const row = event.target.closest(".team-game-log tr[data-date]");
  if (row) {
    const { data, season } = state.teamCard;
    track("team_card_game", { team_id: data.team.id, date: row.dataset.date });
    openView(`team=${data.team.abbreviation}&season=${season}&date=${row.dataset.date}`);
  }
}

// The card's dialog closed.
export function teamCardClosed() {
  const id = state.teamCard?.id;
  state.teamCard = null;
  cardClosed("team", id);
}
