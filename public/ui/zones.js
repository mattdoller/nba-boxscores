// Hot and cold zones on the game's court: shading, tooltips, the outline
// of a hovered zone, and the flash when a shot is taken from one.
import { projectHalf } from "../lib/court.js";
import { escapeHtml } from "../lib/format.js";
import { loadPref, savePref } from "../lib/prefs.js";
import { ZONE_CLIPS, ZONE_LAYERS, ZONE_NAMES, zoneComparison, zoneTotals } from "../lib/zones.js";
import { getJson } from "./api.js";
import { madeVar, reduceMotion, svgEl } from "./flights.js";
import { pathFrom } from "./floor.js";
import { loadToken } from "./games.js";
import { paced, playback } from "./playback.js";
import { shotsByTeam } from "./shotchart.js";
import { state } from "./state.js";
import { showTooltip } from "./tooltip.js";

// Hot and cold zones under each team's shots: each of stats.nba.com's
// half-court zones shaded by how the team shot there against the league
// that season, warmer for better and colder for worse. Off until switched
// on (and remembered), which loads the league's numbers (null until then,
// "error" if they couldn't be loaded). During playback they count only the
// shots so far.
export let showZones = loadPref("zones", false) === true;

// One zone shape's fill: the panel color with no attempts there, otherwise
// tinted toward hot or cold by how far off the league the team shot.
export function zoneFill(team, league) {
  const comparison = zoneComparison(team, league);
  if (!comparison) {
    return "";
  }

  let color = "var(--zone-cold)";
  if (comparison.diff > 0) {
    color = "var(--zone-hot)";
  }
  // Kept light enough that the team-colored shots on top stay easy to see.
  return `fill: color-mix(in srgb, ${color} ${Math.round(8 + 32 * comparison.strength)}%, var(--panel))`;
}

function halfPath(side, points) {
  return `${pathFrom(points.map(([hx, hy]) => projectHalf(side, hx, hy)))} Z`;
}

// The zones for each half: [[team, shots, side], ...].
export function zonesMarkup(halves) {
  if (!showZones || !state.leagueZones || state.leagueZones === "error") {
    return "";
  }

  return halves.map(([team, shots, side]) => {
    const totals = zoneTotals(shots);
    const clips = Object.entries(ZONE_CLIPS)
      .map(([name, points]) => `<clipPath id="zone-clip-${side}-${name}"><path d="${halfPath(side, points)}" /></clipPath>`)
      .join("");
    const layers = ZONE_LAYERS.map(({ zone, points, clip }) => {
      let clipPath = "";
      if (clip) {
        clipPath = ` clip-path="url(#zone-clip-${side}-${clip})"`;
      }
      return `<path class="zone" data-zone="${escapeHtml(zone)}" data-team="${team.id}" d="${halfPath(side, points)}"${clipPath}
        style="${zoneFill(totals[zone], state.leagueZones[zone])}" />`;
    }).join("");
    return clips + layers;
  }).join("");
}

// The shots a team's zones count: those launched so far during playback,
// otherwise every shot on its half.
function zoneShots(teamId) {
  if (playback) {
    return playback.shots.slice(0, playback.next)
      .filter((entry) => String(entry.team.id) === String(teamId))
      .map((entry) => entry.shot);
  }
  return shotsByTeam.get(String(teamId)) ?? [];
}

export function drawZones() {
  const layer = document.querySelector("#shotcharts .zones-layer");
  if (!layer || !state.currentGame) {
    return;
  }

  const { away, home } = state.currentGame;
  const shown = showZones && state.leagueZones && state.leagueZones !== "error";
  if (shown && layer.querySelector(".zone")) {
    // Already drawn: only the fills change, so recolor in place. That keeps
    // any zone flashing for a shot (see pulseZone) going as playback counts it.
    const totals = { [away.id]: zoneTotals(zoneShots(away.id)), [home.id]: zoneTotals(zoneShots(home.id)) };
    for (const shape of layer.querySelectorAll(".zone")) {
      const { team, zone } = shape.dataset;
      shape.setAttribute("style", zoneFill(totals[team][zone], state.leagueZones[zone]));
    }
  } else {
    layer.innerHTML = zonesMarkup([[away, zoneShots(away.id), "left"], [home, zoneShots(home.id), "right"]]);
    outlineZone(layer.ownerSVGElement, null);
  }
  const key = document.querySelector("#shotcharts .zones-key");
  key.hidden = !showZones;
  key.innerHTML = zonesKeyMarkup();
}

export function zonesKeyMarkup() {
  if (state.leagueZones === "error") {
    return "League averages couldn’t be loaded.";
  }
  return 'Colder <span class="zones-scale"></span> Hotter than the league';
}

// Fetches the league's numbers for the game on screen, once, then draws the zones.
export async function loadLeagueZones() {
  if (state.leagueZones && state.leagueZones !== "error") {
    drawZones();
    return;
  }

  const token = loadToken;
  try {
    const zones = await getJson(`/api/shotzones?game_id=${state.currentGame.id}`);
    if (token === loadToken) {
      state.leagueZones = zones;
    }
  } catch (err) {
    if (token === loadToken) {
      state.leagueZones = "error";
      track("load_error", { section: "shotzones", game_id: state.currentGame.id, message: err.message });
    }
  }
  if (token === loadToken) {
    drawZones();
  }
}

export function toggleZones(event) {
  if (event.target.id !== "zonesToggle") {
    return;
  }

  showZones = event.target.checked;
  savePref("zones", showZones);
  track("zones_toggle", { on: showZones });
  if (showZones) {
    loadLeagueZones();
  } else {
    drawZones();
  }
}

// Returns true when the pointer is over a zone (and no shot) and its tooltip is showing.
export function showZoneTooltip(event) {
  const zone = event.target.closest?.(".zone");
  if (!zone) {
    return false;
  }

  const team = zoneTotals(zoneShots(zone.dataset.team))[zone.dataset.zone];
  const league = state.leagueZones?.[zone.dataset.zone];
  let line = "No shots";
  if (team) {
    line = `${team.fgm} of ${team.fga} (${((team.fgm / team.fga) * 100).toFixed(1)}%)`;
  }
  let leagueLine = "";
  if (league?.fga) {
    leagueLine = `<span class="muted">League ${((league.fgm / league.fga) * 100).toFixed(1)}%</span>`;
  }
  showTooltip(`
    <strong>${escapeHtml(ZONE_NAMES[zone.dataset.zone])}</strong>
    <span>${escapeHtml(line)}</span>
    ${leagueLine}`, event.clientX, event.clientY);
  return true;
}

// How long a zone's flash lasts when a shot is taken from it.
const ZONE_PULSE_MS = 700;

// With hot/cold zones on, flashes the zone a shot is taken from in the
// shooting team's color. Each of the zone's shapes gets a copy just above
// it, so the zones painted over it cover the flash too, and only the part of
// the floor that's in the zone lights up.
export function pulseZone(mark, shot) {
  if (!showZones || reduceMotion.matches || !shot.zone) {
    return;
  }

  const shapes = mark.ownerSVGElement.querySelectorAll(
    `.zone[data-team="${mark.dataset.team}"][data-zone="${shot.zone}"]`,
  );
  const color = mark.closest(".half").style.getPropertyValue("--made");
  for (const shape of shapes) {
    const pulse = svgEl("path", { class: "zone-pulse", d: shape.getAttribute("d"), style: madeVar(color) });
    const clip = shape.getAttribute("clip-path");
    if (clip) {
      pulse.setAttribute("clip-path", clip);
    }
    shape.after(pulse);
    pulse.animate(
      [{ opacity: 0 }, { opacity: 0.45, offset: 0.25 }, { opacity: 0 }],
      { duration: paced(ZONE_PULSE_MS), easing: "ease-out" },
    ).finished.then(() => pulse.remove(), () => pulse.remove());
  }
}

// How wide a hovered zone's outline is, in screen pixels.
const ZONE_OUTLINE_PX = 1.5;
let zoneOutlines = 0;

// Outlines a zone on a court (only a team's zones, when given) where it
// shows: its shapes, less what the zones painted over them cover. A plain
// stroke would trace the hidden parts too, so the court's zones are copied
// into a mask, this zone's white and the rest black, and a filter keeps just
// the inside edge of the white. No zone clears the outline.
export function outlineZone(svg, zone, team) {
  const layer = svg?.querySelector(".zone-outline");
  if (!layer) {
    return;
  }
  const key = zone ? `${team ?? ""}|${zone}` : "";
  if (layer.dataset.key === key) {
    return;
  }

  layer.dataset.key = key;
  layer.replaceChildren();
  const shapes = [...svg.querySelectorAll(".zone")].filter((shape) => team == null || shape.dataset.team === team);
  const own = shapes.filter((shape) => shape.dataset.zone === zone);
  if (own.length === 0) {
    return;
  }

  // The zone shows only inside its own shapes, so the mask and filter cover
  // just those, with room for the edge.
  const unit = 1 / (svg.getScreenCTM()?.a || 1);
  const pad = 4 * unit;
  const boxes = own.map((shape) => shape.getBBox());
  const x = Math.min(...boxes.map((box) => box.x)) - pad;
  const y = Math.min(...boxes.map((box) => box.y)) - pad;
  const bounds = {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) + pad - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) + pad - y,
  };
  const id = `zone-outline-${++zoneOutlines}`;
  const mask = svgEl("mask", { id: `${id}-mask`, maskUnits: "userSpaceOnUse", ...bounds });
  for (const shape of shapes) {
    let fill = "black";
    if (shape.dataset.zone === zone) {
      fill = "white";
    }
    const copy = svgEl("path", { d: shape.getAttribute("d"), fill });
    const clip = shape.getAttribute("clip-path");
    if (clip) {
      copy.setAttribute("clip-path", clip);
    }
    mask.append(copy);
  }
  const filter = svgEl("filter", { id: `${id}-edge`, filterUnits: "userSpaceOnUse", ...bounds });
  filter.append(
    svgEl("feMorphology", { in: "SourceAlpha", operator: "erode", radius: ZONE_OUTLINE_PX * unit, result: "inner" }),
    svgEl("feComposite", { in: "SourceAlpha", in2: "inner", operator: "out", result: "edge" }),
    svgEl("feFlood", {}),
    svgEl("feComposite", { in2: "edge", operator: "in" }),
  );
  const outline = svgEl("g", { filter: `url(#${id}-edge)` });
  outline.append(svgEl("rect", { ...bounds, mask: `url(#${id}-mask)` }));
  layer.append(svgEl("defs", {}), outline);
  layer.firstChild.append(mask, filter);
}

// Outlines the zone under the pointer on the game's court, if any.
export function outlineHoveredZone(event) {
  const svg = document.querySelector("#shotcharts svg");
  const zone = event.target.closest?.("#shotcharts .zone");
  outlineZone(svg, zone?.dataset.zone, zone?.dataset.team);
}
