// What the player and team cards share: a season's hot/cold zones on a half
// court seen from above and in a list, highlighting a zone in both at once,
// and shading a stat against the league.
import { escapeHtml, round1 } from "../lib/format.js";
import { ZONE_CLIPS, ZONE_LABEL_SPOTS, ZONE_LAYERS, ZONE_NAMES, zoneComparison } from "../lib/zones.js";
import { sortHeader } from "./cardsort.js";
import { HALF_COURT_LINES } from "./floor.js";
import { outlineZone, zoneFill } from "./zones.js";

export function percent(made, attempts) {
  if (!attempts) {
    return "–";
  }
  return ((made / attempts) * 100).toFixed(1);
}

export function seasonLabel(season) {
  return `${season}–${String(season + 1).slice(2)}`;
}

// A cell's background and tooltip, as attributes: red for better than the
// league, blue for worse, stronger with `strength` (0–1).
export function shadeAttrs(better, strength, title) {
  let color = "var(--zone-cold)";
  if (better) {
    color = "var(--zone-hot)";
  }
  return ` style="background: color-mix(in srgb, ${color} ${Math.round(6 + 34 * strength)}%, var(--panel))" title="${escapeHtml(title)}"`;
}

function flatPath(points, close = true) {
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${round1(x)} ${round1(y)}`).join(" ");
  if (close) {
    return `${d} Z`;
  }
  return d;
}

// A half court seen from above, hoop at the top: hoop coordinates drawn as
// they are, x across and y toward half court (down the screen). `id` keeps
// each card's clip paths apart.
function zonesCourt(data, label, id) {
  const clips = Object.entries(ZONE_CLIPS)
    .map(([name, points]) => `<clipPath id="${id}-clip-${name}"><path d="${flatPath(points)}" /></clipPath>`)
    .join("");
  const zones = ZONE_LAYERS.map(({ zone, points, clip }) => {
    let clipPath = "";
    if (clip) {
      clipPath = ` clip-path="url(#${id}-clip-${clip})"`;
    }
    return `<path class="zone" data-zone="${escapeHtml(zone)}" d="${flatPath(points)}"${clipPath} style="${zoneFill(data.zones[zone], data.league[zone])}" />`;
  }).join("");
  const lines = HALF_COURT_LINES.map(({ points, dashed, kind }) =>
    `<path class="court-line${dashed ? " dashed" : ""}${kind ? ` ${kind}` : ""}" d="${flatPath(points, false)}" />`).join("");
  const labels = Object.entries(ZONE_LABEL_SPOTS).map(([zone, [x, y]]) => {
    const own = data.zones[zone];
    if (!own?.fga) {
      return `<text class="zone-label empty" x="${x}" y="${y}">–</text>`;
    }
    return `
      <text class="zone-label" x="${x}" y="${y}">${Math.round((own.fgm / own.fga) * 100)}%</text>
      <text class="zone-count" x="${x}" y="${y + 15}">${own.fgm}/${own.fga}</text>`;
  }).join("");
  return `
    <svg class="card-court" viewBox="-260 -60 520 492" role="img" aria-label="${escapeHtml(label)}">
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

// The zones as a list: the shooting against the league's.
function zonesList(data) {
  const rows = Object.keys(ZONE_NAMES).map((zone) => {
    const own = data.zones[zone];
    const league = data.league[zone];
    const comparison = zoneComparison(own, league);
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
        <td data-value="${own?.fga ?? ""}">${own ? `${own.fgm}/${own.fga}` : "–"}</td>
        <td>${own ? percent(own.fgm, own.fga) : "–"}</td>
        <td>${league ? percent(league.fgm, league.fga) : "–"}</td>
        <td class="${tone}">${diff}</td>
      </tr>`;
  }).join("");
  return `
    <div class="table-wrap">
      <table class="stats zone-list" data-sort-table="zones">
        <thead>
          <tr>${sortHeader("Zone", { text: true })}${sortHeader("FG", { title: "Made and attempted; sorts by attempts" })}${sortHeader("FG%")}${sortHeader("League")}${sortHeader("+/-")}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// No shots anywhere: the court and list drawn empty while a season loads.
const NO_ZONES = { zones: {}, league: {} };

// The court and the list for a season's zones: `data` from /api/playerzones
// or /api/teamzones, "loading", or an Error. Both are always drawn, empty
// until the zones arrive, so the card keeps its size while they load; only
// the line under them says what's going on.
export function zonesBody(data, label, id) {
  let shown = NO_ZONES;
  let status = "<span>Loading zones…</span>";
  if (data instanceof Error) {
    status = `<span class="notice">${escapeHtml(data.message)}</span>`;
  } else if (data && data !== "loading") {
    shown = data;
    status = `<span>${Object.values(data.zones).reduce((sum, z) => sum + z.fga, 0)} shots</span>`;
  }
  return `
    <div class="card-zones-body">
      ${zonesCourt(shown, label, id)}
      ${zonesList(shown)}
    </div>
    <p class="legend">
      ${status}
      <span class="zones-key">Colder <span class="zones-scale"></span> Hotter than the league</span>
    </p>`;
}

// Marks a zone on a card both ways: outlined on the court, and its row
// highlighted in the zone list. No zone clears both.
export function highlightCardZone(dialog, zone) {
  outlineZone(dialog.querySelector(".card-court"), zone);
  for (const row of dialog.querySelectorAll(".zone-list tr[data-zone]")) {
    row.classList.toggle("zone-hover", row.dataset.zone === zone);
  }
}

// Highlights the zone under the pointer on a card's court or in its list.
// Listens on the card's dialog.
export function outlineCardZone(event) {
  const hovered = event.target.closest(".card-court .zone, .zone-list tr[data-zone]");
  highlightCardZone(event.currentTarget, hovered?.dataset.zone);
}
