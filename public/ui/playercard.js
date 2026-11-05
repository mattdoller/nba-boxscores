// The player card: a modal over the game with a player's career, shaded
// against the league, and their hot/cold zones by season.
import { escapeHtml, round1 } from "../lib/format.js";
import { loadPref, savePref } from "../lib/prefs.js";
import { ZONE_CLIPS, ZONE_LABEL_SPOTS, ZONE_LAYERS, ZONE_NAMES, zoneComparison } from "../lib/zones.js";
import { getJson } from "./api.js";
import { currentStats } from "./boxscore.js";
import { seasonSelect } from "./dom.js";
import { HALF_COURT_LINES } from "./floor.js";
import { teamById } from "./playback.js";
import { state } from "./state.js";
import { hideTooltip } from "./tooltip.js";
import { outlineZone, zoneFill } from "./zones.js";

// The player card: a modal over the game with a player's regular-season
// career, and their hot/cold zones for any season with shot data, on a
// half court seen from above with the hoop at the top.
export const playerDialog = document.getElementById("playerDialog");

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
  const seasons = state.playerCard.career?.seasons ?? [];
  const leagues = seasons.map((s) => state.playerCard.league.get(s.season));
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
    const picked = state.playerCard.season === season;
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
  const { career, error } = state.playerCard;
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
      const league = state.playerCard.league.get(s.season);
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
  return (state.playerCard.career?.seasons ?? [])
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
      aria-label="${escapeHtml(`${state.playerCard.name}'s shooting by zone`)}">
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
  const { career, error } = state.playerCard;
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
      .map((season) => `<option value="${season}"${season === state.playerCard.season ? " selected" : ""}>${seasonLabel(season)}</option>`)
      .join("");
  }
  const data = state.playerCard.zones.get(state.playerCard.season);
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
  if (!state.playerCard) {
    return;
  }

  const { name, team, position } = state.playerCard;
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
  const card = state.playerCard;
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
  if (card === state.playerCard) {
    renderPlayerCard();
  }
}

// Fetches the league's totals for each of the player's seasons with them,
// one at a time so a long career doesn't fire a burst of requests, shading
// each season as its totals arrive. Seasons that can't be loaded stay plain.
async function loadLeagueSeasons(card) {
  const seasons = zoneSeasons().reverse();
  if (seasons.length === 0) {
    return;
  }

  let totals = {};
  try {
    totals = await getJson(`/api/league?seasons=${seasons.join(",")}`);
  } catch {
    // Left unshaded, like any season without league totals.
  }
  if (card !== state.playerCard) {
    return;
  }
  for (const season of seasons) {
    card.league.set(season, totals[season] ?? null);
  }
  renderPlayerCard();
}

export async function openPlayerCard(event) {
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
  state.playerCard = card;
  track("player_card_open", { player_id: Number(card.id), player: card.name });
  hideTooltip();
  renderPlayerCard();
  playerDialog.showModal();

  try {
    card.career = await getJson(`/api/player?player_id=${card.id}`);
  } catch (err) {
    card.error = err.message;
  }
  if (card !== state.playerCard) {
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
export function outlineCardZone(event) {
  const hovered = event.target.closest(".card-court .zone, .zone-list tr[data-zone]");
  highlightCardZone(hovered?.dataset.zone);
}

// Marks a zone on the card both ways: outlined on the court, and its row
// highlighted in the zone list. No zone clears both.
export function highlightCardZone(zone) {
  outlineZone(playerDialog.querySelector(".card-court"), zone);
  for (const row of playerDialog.querySelectorAll(".zone-list tr[data-zone]")) {
    row.classList.toggle("zone-hover", row.dataset.zone === zone);
  }
}

export function playerCardClick(event) {
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
    track("player_card_season", { player_id: Number(state.playerCard.id), season: Number(row.dataset.season), source: "career" });
    loadPlayerZones(Number(row.dataset.season));
  }
}

export function playerCardChange(event) {
  if (event.target.id === "cardZoneSeason") {
    track("player_card_season", { player_id: Number(state.playerCard.id), season: Number(event.target.value), source: "menu" });
    loadPlayerZones(Number(event.target.value));
  }
}
