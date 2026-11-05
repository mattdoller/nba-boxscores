// Each team's five-man units: who played together, for how long, and what
// they outscored the other team by, from /api/lineups. The tables sort like
// the cards' (see cardsort.js), and start with each team's most-used units.
import { escapeHtml } from "../lib/format.js";
import { applyCardSorts, sortHeader } from "./cardsort.js";
import { currentStats } from "./boxscore.js";
import { state } from "./state.js";

// The units shown before "Show all": a team uses a few for most of a game,
// and a long tail for a minute or two each.
const LINEUPS_SHOWN = 10;

// Whether each team's table shows every unit, by team id.
const showingAll = new Set();

// The lineups data on screen, kept to redraw when a table expands.
let lineups = null;

function minutesLabel(seconds) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function signed(n) {
  if (n > 0) {
    return `+${n}`;
  }
  return String(n);
}

// Red for a unit that outscored the other team, blue for one outscored.
function tone(net) {
  if (net > 0) {
    return "hot";
  }
  if (net < 0) {
    return "cold";
  }
  return "";
}

// A unit's players in the box score's order (starters first, then by
// minutes), so the same players read the same way in every row.
function playersInOrder(unit, order) {
  return [...unit.players].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function teamTable(team, units) {
  const order = currentStats.filter((p) => p.team_id === team.id).map((p) => p.player_id);
  const all = showingAll.has(team.id);
  const shown = all ? units : units.slice(0, LINEUPS_SHOWN);
  const rows = shown.map((unit) => {
    const names = playersInOrder(unit, order).map((id) => escapeHtml(lineups.players[id] ?? id)).join(" · ");
    const net = unit.pts_for - unit.pts_against;
    return `
      <tr>
        <th class="lineup">${names}</th>
        <td data-value="${unit.seconds}">${minutesLabel(unit.seconds)}</td>
        <td>${unit.pts_for}</td>
        <td>${unit.pts_against}</td>
        <td class="${tone(net)}">${signed(net)}</td>
      </tr>`;
  }).join("");
  let more = "";
  if (units.length > LINEUPS_SHOWN) {
    more = `<button type="button" class="show-lineups" data-team="${team.id}">${all ? "Show fewer" : `Show all ${units.length}`}</button>`;
  }
  return `
    <section class="team-lineups" data-team="${team.id}">
      <h3>${escapeHtml(team.full_name)}</h3>
      <div class="table-wrap">
        <table class="stats lineups-table" data-sort-table="lineups">
          <thead>
            <tr>${sortHeader("Lineup", { text: true })}${sortHeader("MIN")}${sortHeader("PTS", { title: "Points scored with this five on the floor" })}${sortHeader("OPP", { title: "Points allowed with this five on the floor" })}${sortHeader("+/-")}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${more}
    </section>`;
}

export function renderLineups(data) {
  lineups = data;
  const { away, home } = state.currentGame;
  const teams = [away, home].filter((team) => data.teams[team.id]?.length);
  if (teams.length === 0) {
    return '<p class="hint">No lineups for this game: its play-by-play has no substitutions.</p>';
  }
  return `
    <div class="lineups">${teams.map((team) => teamTable(team, data.teams[team.id])).join("")}</div>
    <p class="hint">Whole game. Worked out from the play-by-play's substitutions, so a unit's numbers can be off from the official ones by a point or two.</p>`;
}

// Draws the lineups into their section, in each table's remembered sort.
export function drawLineups(data) {
  const el = document.getElementById("lineups");
  el.innerHTML = renderLineups(data);
  applyCardSorts(el);
}

// "Show all" and "Show fewer" under a team's table.
export function toggleLineups(event) {
  const button = event.target.closest(".show-lineups");
  if (!button || !lineups) {
    return;
  }

  const teamId = Number(button.dataset.team);
  if (showingAll.has(teamId)) {
    showingAll.delete(teamId);
  } else {
    showingAll.add(teamId);
  }
  track("lineups_toggle", { team_id: teamId, all: showingAll.has(teamId) });
  drawLineups(lineups);
}
