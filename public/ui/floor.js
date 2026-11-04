// The court drawn in 3D: its floor, with each arena's own boards, and its
// lines and hoops.
import { arcPoints, KEY_AREA, project, projectHalf, THREE_POINT_AREA } from "../lib/court.js";
import { round1 } from "../lib/format.js";

// One half's floor markings, in hoop coordinates.
export const HALF_COURT_LINES = [
  { points: [[-250, -47.5], [250, -47.5], [250, 422.5], [-250, 422.5], [-250, -47.5]] },
  { points: [[-80, -47.5], [-80, 142.5], [80, 142.5], [80, -47.5]] },
  { points: [[-60, -47.5], [-60, 142.5], [60, 142.5], [60, -47.5]] },
  { points: arcPoints(0, 142.5, 60, 0, 180) },
  { points: arcPoints(0, 142.5, 60, 180, 360), dashed: true, onKey: true },
  { points: arcPoints(0, 0, 40, 0, 180), onKey: true },
  { points: [[-220, -47.5], [-220, 89.5], ...arcPoints(0, 0, 237.5, 157.9, 22.1, 48), [220, 89.5], [220, -47.5]], kind: "three-point-line" },
  // Also the top of the key above; drawn again on its own so it can be thicker.
  { points: [[-80, 142.5], [80, 142.5]], kind: "free-throw-line" },
];

// The rim is 10 ft up; the backboard spans 9–12.5 ft, 6 ft wide, 4 ft in from
// the baseline, held up by a stanchion behind the baseline.
export const RIM_HEIGHT = 100;
const RIM_RADIUS = 7.5;

export function pathFrom(points) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

function renderHoop(side) {
  const at = (hx, hy, z) => projectHalf(side, hx, hy, z);
  const board = [at(-30, -7.5, 90), at(30, -7.5, 90), at(30, -7.5, 125), at(-30, -7.5, 125)];
  const rim = arcPoints(0, 0, RIM_RADIUS, 0, 360, 24).map(([hx, hy]) => at(hx, hy, RIM_HEIGHT));
  const stanchion = [at(0, -67.5, 0), at(0, -67.5, 115), at(0, -7.5, 115)];
  return `
    <path class="stanchion" d="${pathFrom(stanchion)}" />
    <path class="backboard" d="${pathFrom(board)} Z" />
    <path class="rim" d="${pathFrom(rim)} Z" />`;
}

const COURT_CORNERS = [[0, 0], [940, 0], [940, 500], [0, 500]].map(([x, y]) => project({ x, y, z: 0 }));

// The floor and its markings never change, so they're built once.
export const COURT_FLOOR = `<path class="court-floor" d="${pathFrom(COURT_CORNERS)} Z" />`;

export const COURT_LINES = `
  ${["left", "right"].flatMap((side) => HALF_COURT_LINES.map(({ points, dashed, onKey, kind }) => `
    <path class="court-line${dashed ? " dashed" : ""}${onKey ? " on-key" : ""}${kind ? ` ${kind}` : ""}" data-side="${side}"
      d="${pathFrom(points.map(([hx, hy]) => projectHalf(side, hx, hy)))}" />`)).join("")}`;

export const COURT_HOOPS = renderHoop("left") + renderHoop("right");

// A circle at center court, on the floor.
function centerCircle(r) {
  return `${pathFrom(arcPoints(470, 250, r, 0, 360, 64).map(([x, y]) => project({ x, y, z: 0 })))} Z`;
}

function floorArea(points) {
  return ["left", "right"]
    .map((side) => `${pathFrom(points.map(([hx, hy]) => projectHalf(side, hx, hy)))} Z`)
    .join(" ");
}

// Light gray shading inside both three-point lines, a little darker in the
// keys and the center disk (its inner circle left white). Court lines go over it.
export const FLOOR_SHADING = `
  <path class="three-point-area" d="${floorArea(THREE_POINT_AREA)}" />
  <path class="key-area" d="${floorArea(KEY_AREA)}" />
  <path class="center-disk" d="${centerCircle(60)}" />
  <path class="center-inner" d="${centerCircle(20)}" />`;

export const CENTER_RINGS = `
  <path class="center-ring" d="${centerCircle(60)}" />
  <path class="center-ring" d="${centerCircle(20)}" />`;

// A straight line on the floor, in world coordinates.
function floorSegment(x1, y1, x2, y2) {
  const a = project({ x: x1, y: y1, z: 0 });
  const b = project({ x: x2, y: y2, z: 0 });
  return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
}

// Floorboards run the length of the court. Real ones are about 2¼" wide;
// these are a foot wide so they don't blur together at chart size. Each
// row's board ends are staggered from its neighbors' by cycling through
// these lengths from a different starting point.
const PLANK_WIDTH = 10;
const PLANK_LENGTHS = [40, 55, 30, 50, 65, 35, 45];

const WOOD_FLOOR = (() => {
  const d = [];
  for (let y = PLANK_WIDTH; y < 500; y += PLANK_WIDTH) {
    d.push(floorSegment(0, y, 940, y));
  }
  for (let row = 0; row < 500 / PLANK_WIDTH; row++) {
    const y = row * PLANK_WIDTH;
    let i = (row * 3) % PLANK_LENGTHS.length;
    for (let x = 5 + ((row * 23) % 40); x < 940; x += PLANK_LENGTHS[i++ % PLANK_LENGTHS.length]) {
      d.push(floorSegment(x, y, x, y + PLANK_WIDTH));
    }
  }
  return `<path class="floorboards" d="${d.join(" ")}" />`;
})();

// The Celtics' parquet: squares of boards, about 5 ft on a side, each
// square's boards turned a quarter turn from its neighbors'.
const PARQUET_COLUMNS = 20;
const PARQUET_ROWS = 10;
const PARQUET_BOARDS = 5;

const PARQUET_FLOOR = (() => {
  const w = 940 / PARQUET_COLUMNS;
  const h = 500 / PARQUET_ROWS;
  const squares = [];
  const boards = [];
  for (let c = 1; c < PARQUET_COLUMNS; c++) {
    squares.push(floorSegment(c * w, 0, c * w, 500));
  }
  for (let r = 1; r < PARQUET_ROWS; r++) {
    squares.push(floorSegment(0, r * h, 940, r * h));
  }
  for (let c = 0; c < PARQUET_COLUMNS; c++) {
    for (let r = 0; r < PARQUET_ROWS; r++) {
      const x = c * w;
      const y = r * h;
      for (let b = 1; b < PARQUET_BOARDS; b++) {
        if ((c + r) % 2 === 0) {
          boards.push(floorSegment(x, y + (b * h) / PARQUET_BOARDS, x + w, y + (b * h) / PARQUET_BOARDS));
        } else {
          boards.push(floorSegment(x + (b * w) / PARQUET_BOARDS, y, x + (b * w) / PARQUET_BOARDS, y + h));
        }
      }
    }
  }
  return `
    <path class="floorboards" d="${boards.join(" ")}" />
    <path class="floorboards parquet-squares" d="${squares.join(" ")}" />`;
})();

// The Magic's floor from 2025-26 on: squares of four boards, turned a
// quarter turn from their neighbors', set apart by narrow strips of short
// boards laid across them. A little over 6 ft from one strip to the next.
const MAGIC_COLUMNS = 15;
const MAGIC_ROWS = 8;
const MAGIC_BOARDS = 4;
const MAGIC_STRIP = 9;

const MAGIC_FLOOR = (() => {
  const w = 940 / MAGIC_COLUMNS;
  const h = 500 / MAGIC_ROWS;
  const half = MAGIC_STRIP / 2;
  const strips = [];
  const boards = [];
  // Each strip's two edges, centered on the lines between squares. Those at
  // the sidelines and baselines are half strips.
  for (let c = 0; c <= MAGIC_COLUMNS; c++) {
    for (const x of [c * w - half, c * w + half]) {
      if (x > 0 && x < 940) {
        strips.push(floorSegment(x, 0, x, 500));
      }
    }
  }
  for (let r = 0; r <= MAGIC_ROWS; r++) {
    for (const y of [r * h - half, r * h + half]) {
      if (y > 0 && y < 500) {
        strips.push(floorSegment(0, y, 940, y));
      }
    }
  }
  for (let c = 0; c < MAGIC_COLUMNS; c++) {
    for (let r = 0; r < MAGIC_ROWS; r++) {
      const left = c * w + half;
      const top = r * h + half;
      const right = (c + 1) * w - half;
      const bottom = (r + 1) * h - half;
      for (let b = 1; b < MAGIC_BOARDS; b++) {
        const x = left + (b * (right - left)) / MAGIC_BOARDS;
        const y = top + (b * (bottom - top)) / MAGIC_BOARDS;
        if ((c + r) % 2 === 0) {
          boards.push(floorSegment(left, y, right, y));
        } else {
          boards.push(floorSegment(x, top, x, bottom));
        }
        // The short boards in the strips beside the square, on its left and
        // above it, lined up with its boards.
        if (c > 0) {
          boards.push(floorSegment(left - MAGIC_STRIP, y, left, y));
        }
        if (r > 0) {
          boards.push(floorSegment(x, top - MAGIC_STRIP, x, top));
        }
      }
    }
  }
  return `
    <path class="floorboards" d="${boards.join(" ")}" />
    <path class="floorboards parquet-squares" d="${strips.join(" ")}" />`;
})();

// The Nets' herringbone: boards laid on a slant, turning at every board's
// length, so their edges zigzag across the floor and the turns line up in
// points that all face the same way. Each turn runs 1.4 ft along the court
// and 0.9 ft across it, and the zigzags are 2.8 ft apart: bigger than real
// boards, so they don't blur together at chart size.
const HERRINGBONE_SPACING = 28;
const HERRINGBONE_RUN = 14;
const HERRINGBONE_TURN = 9;

// The part of a line on the floor that's inside the court, if any.
function courtSegment(x1, y1, x2, y2) {
  let from = 0;
  let to = 1;
  for (const [start, delta, min, max] of [[x1, x2 - x1, 0, 940], [y1, y2 - y1, 0, 500]]) {
    if (delta === 0) {
      if (start < min || start > max) {
        return "";
      }
      continue;
    }
    const a = (min - start) / delta;
    const b = (max - start) / delta;
    from = Math.max(from, Math.min(a, b));
    to = Math.min(to, Math.max(a, b));
  }
  if (to <= from) {
    return "";
  }
  return floorSegment(x1 + from * (x2 - x1), y1 + from * (y2 - y1), x1 + to * (x2 - x1), y1 + to * (y2 - y1));
}

const HERRINGBONE_FLOOR = (() => {
  const d = [];
  for (let x = -HERRINGBONE_RUN; x < 940; x += HERRINGBONE_SPACING) {
    for (let y = 0, step = 0; y < 500; y += HERRINGBONE_TURN, step++) {
      // Out and back: each edge points the same way at every turn.
      let dx = HERRINGBONE_RUN;
      if (step % 2 === 1) {
        dx = -HERRINGBONE_RUN;
      }
      const from = x + (step % 2) * HERRINGBONE_RUN;
      const segment = courtSegment(from, y, from + dx, y + HERRINGBONE_TURN);
      if (segment) {
        d.push(segment);
      }
    }
  }
  return `<path class="floorboards" d="${d.join(" ")}" />`;
})();

// Floors that aren't plain wood, by arena: the Celtics' parquet in Boston,
// the Nets' herringbone in Brooklyn since 2015-16, and the Magic's squares
// in Orlando since 2025-26. Games without a venue go by the home team.
const HOME_FLOORS = [
  { team: "BOS", arena: /\b(TD|Boston) Garden\b/i, floor: PARQUET_FLOOR },
  { team: "BKN", arena: /\bBarclays Center\b/i, since: "2015-07-01", floor: HERRINGBONE_FLOOR },
  { team: "ORL", arena: /\b(Kia|Amway) Center\b/i, since: "2025-07-01", floor: MAGIC_FLOOR },
];

export function floorGrain(game) {
  const home = HOME_FLOORS.find(({ team, arena, since = "" }) => {
    let here = game.home.abbreviation === team;
    if (game.venue) {
      here = arena.test(game.venue.name);
    }
    return here && game.date >= since;
  });
  return home?.floor ?? WOOD_FLOOR;
}

// Fits the floor and both backboards, with a little room for flights above.
export const COURT_VIEWBOX = (() => {
  const points = [...COURT_CORNERS, ...["left", "right"].map((side) => projectHalf(side, 0, -7.5, 200))];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = 12;
  const left = Math.min(...xs) - pad;
  const top = Math.min(...ys) - pad;
  return `${round1(left)} ${round1(top)} ${round1(Math.max(...xs) + pad - left)} ${round1(Math.max(...ys) + pad - top)}`;
})();
