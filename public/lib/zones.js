// Hot and cold shot zones: how a team shot from each of stats.nba.com's
// half-court zones, against the league average there.
import { arcPoints, HALF_COURT_AREA, KEY_AREA, THREE_POINT_AREA } from "./court.js";

// The 14 half-court zones, keyed like the server's shot `zone`: basic zone
// and area. Shots from the backcourt aren't in any of them.
export const ZONE_NAMES = {
  "Restricted Area|Center(C)": "Restricted area",
  "In The Paint (Non-RA)|Center(C)": "Paint, center",
  "In The Paint (Non-RA)|Left Side(L)": "Paint, left side",
  "In The Paint (Non-RA)|Right Side(R)": "Paint, right side",
  "Mid-Range|Center(C)": "Mid-range, center",
  "Mid-Range|Left Side(L)": "Mid-range, left side",
  "Mid-Range|Left Side Center(LC)": "Mid-range, left center",
  "Mid-Range|Right Side Center(RC)": "Mid-range, right center",
  "Mid-Range|Right Side(R)": "Mid-range, right side",
  "Left Corner 3|Left Side(L)": "Left corner 3",
  "Right Corner 3|Right Side(R)": "Right corner 3",
  "Above the Break 3|Left Side Center(LC)": "Above the break 3, left",
  "Above the Break 3|Center(C)": "Above the break 3, center",
  "Above the Break 3|Right Side Center(RC)": "Above the break 3, right",
};

// Reaches past every corner of the half court from the hoop.
const FAR = 600;

// A pie slice from the hoop, in hoop coordinates. Angles are in degrees off
// the line from the hoop to half court, positive toward +x (the right side
// of stats.nba.com's chart), so -90 and 90 run along the baseline.
export function wedge(from, to, radius = FAR) {
  return [[0, 0], ...arcPoints(0, 0, radius, 90 - from, 90 - to, Math.max(8, Math.ceil(Math.abs(to - from) / 4)))];
}

function circle(radius) {
  return arcPoints(0, 0, radius, 0, 360, 48);
}

// Where clip regions can limit a layer to: the half court, inside the
// three-point line, and the key.
export const ZONE_CLIPS = {
  half: HALF_COURT_AREA,
  arc: THREE_POINT_AREA,
  key: KEY_AREA,
};

// The zones as layers, painted in order with each covering the last, so
// simple shapes add up to stats.nba.com's boundaries. Those split by angle
// at 18° and 54° from 16 ft out, and at 30° closer in; the restricted area
// is the 4 ft circle. Each layer is { zone, points, clip }.
export const ZONE_LAYERS = [
  // Threes: beyond the arc, split at 18°, with the corners over them.
  { zone: "Above the Break 3|Left Side Center(LC)", points: wedge(-180, -18), clip: "half" },
  { zone: "Above the Break 3|Center(C)", points: wedge(-18, 18), clip: "half" },
  { zone: "Above the Break 3|Right Side Center(RC)", points: wedge(18, 180), clip: "half" },
  { zone: "Left Corner 3|Left Side(L)", points: [[-250, -47.5], [-220, -47.5], [-220, 89.5], [-250, 89.5]] },
  { zone: "Right Corner 3|Right Side(R)", points: [[220, -47.5], [250, -47.5], [250, 89.5], [220, 89.5]] },
  // Mid-range 16–24 ft, inside the arc.
  { zone: "Mid-Range|Left Side(L)", points: wedge(-180, -54), clip: "arc" },
  { zone: "Mid-Range|Left Side Center(LC)", points: wedge(-54, -18), clip: "arc" },
  { zone: "Mid-Range|Center(C)", points: wedge(-18, 18), clip: "arc" },
  { zone: "Mid-Range|Right Side Center(RC)", points: wedge(18, 54), clip: "arc" },
  { zone: "Mid-Range|Right Side(R)", points: wedge(54, 180), clip: "arc" },
  // Mid-range closer than 16 ft, split at 30°.
  { zone: "Mid-Range|Left Side(L)", points: wedge(-180, -30, 160), clip: "arc" },
  { zone: "Mid-Range|Center(C)", points: wedge(-30, 30, 160), clip: "arc" },
  { zone: "Mid-Range|Right Side(R)", points: wedge(30, 180, 160), clip: "arc" },
  // The paint, split at 30° from 8 ft out.
  { zone: "In The Paint (Non-RA)|Left Side(L)", points: wedge(-180, -30), clip: "key" },
  { zone: "In The Paint (Non-RA)|Center(C)", points: wedge(-30, 30), clip: "key" },
  { zone: "In The Paint (Non-RA)|Right Side(R)", points: wedge(30, 180), clip: "key" },
  { zone: "In The Paint (Non-RA)|Center(C)", points: circle(80), clip: "key" },
  { zone: "Restricted Area|Center(C)", points: circle(40) },
];

// A spot inside each zone for its label, in hoop coordinates.
export const ZONE_LABEL_SPOTS = {
  "Restricted Area|Center(C)": [0, 22],
  "In The Paint (Non-RA)|Center(C)": [0, 112],
  "In The Paint (Non-RA)|Left Side(L)": [-62, 70],
  "In The Paint (Non-RA)|Right Side(R)": [62, 70],
  "Mid-Range|Center(C)": [0, 192],
  "Mid-Range|Left Side(L)": [-170, 30],
  "Mid-Range|Left Side Center(LC)": [-125, 160],
  "Mid-Range|Right Side Center(RC)": [125, 160],
  "Mid-Range|Right Side(R)": [170, 30],
  "Left Corner 3|Left Side(L)": [-235, 30],
  "Right Corner 3|Right Side(R)": [235, 30],
  "Above the Break 3|Left Side Center(LC)": [-180, 300],
  "Above the Break 3|Center(C)": [0, 320],
  "Above the Break 3|Right Side Center(RC)": [180, 300],
};

// Makes and attempts by zone for some shots: { zone: { fgm, fga } }.
export function zoneTotals(shots) {
  const totals = {};
  for (const shot of shots) {
    if (shot.zone in ZONE_NAMES) {
      totals[shot.zone] ??= { fgm: 0, fga: 0 };
      totals[shot.zone].fga++;
      if (shot.made) {
        totals[shot.zone].fgm++;
      }
    }
  }
  return totals;
}

// A difference this far from the league's percentage gets the strongest
// shade; smaller ones are lighter in proportion.
export const ZONE_FULL_SHADE = 0.15;

// How a team's shooting in a zone compares with the league's: `diff` is the
// difference in FG% (as a fraction), and `strength` (0–1) how strongly to
// shade it. Null with no attempts or no league numbers to compare to.
export function zoneComparison(team, league) {
  if (!team?.fga || !league?.fga) {
    return null;
  }

  const diff = team.fgm / team.fga - league.fgm / league.fga;
  return { diff, strength: Math.min(Math.abs(diff) / ZONE_FULL_SHADE, 1) };
}

// Whether a point is inside a polygon (even-odd rule).
function inside([x, y], points) {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      result = !result;
    }
  }
  return result;
}

// The zone drawn at a point in hoop coordinates: the topmost layer covering
// it, within its clip region. Null outside every zone (the backcourt).
export function zoneAt(x, y) {
  for (let i = ZONE_LAYERS.length - 1; i >= 0; i--) {
    const { zone, points, clip } = ZONE_LAYERS[i];
    if (inside([x, y], points) && (!clip || inside([x, y], ZONE_CLIPS[clip]))) {
      return zone;
    }
  }
  return null;
}
