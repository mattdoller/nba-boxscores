import { round1 } from "./format.js";

// The shot chart is a 3D court seen through a simple camera. World
// coordinates are in tenths of a foot: x along the court (0 = left baseline,
// 940 = right), y across it (0 = far sideline, 500 = near), z up from the floor.

// The camera looks down from above the near sideline at 55°: tilted back
// enough to read as 3D, and far enough away that the perspective stays mild.
export const CAMERA_PITCH = (55 * Math.PI) / 180;
export const CAMERA_DISTANCE = 2200;
export const CAMERA_TARGET = { x: 470, y: 250, z: 0 };
export const CAMERA = {
  x: CAMERA_TARGET.x,
  y: CAMERA_TARGET.y + CAMERA_DISTANCE * Math.cos(CAMERA_PITCH),
  z: CAMERA_DISTANCE * Math.sin(CAMERA_PITCH),
};

// Floor marks are drawn as ellipses squashed by this much, to lie on the floor.
export const FLOOR_SQUASH = Math.sin(CAMERA_PITCH);

export function vsub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vdot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vcross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function vnormalize(a) {
  const length = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / length, y: a.y / length, z: a.z / length };
}

export const VIEW = (() => {
  const forward = vnormalize(vsub(CAMERA_TARGET, CAMERA));
  const right = vnormalize(vcross({ x: 0, y: 0, z: 1 }, forward));
  return { forward, right, up: vcross(forward, right) };
})();

// World point -> screen point. `scale` is how big things are drawn there,
// relative to the middle of the court.
export function project(point) {
  const v = vsub(point, CAMERA);
  const depth = vdot(v, VIEW.forward);
  const scale = CAMERA_DISTANCE / depth;
  return {
    x: round1(vdot(v, VIEW.right) * scale),
    y: round1(-vdot(v, VIEW.up) * scale),
    scale,
  };
}

// Shot coordinates are relative to a hoop: x across the court, y out toward
// half court, hoop at (0, 0), baseline at y = -47.5. The away team shoots at
// the left basket and the home team at the right.
export function toWorld(side, hx, hy, z = 0) {
  if (side === "left") {
    return { x: 47.5 + hy, y: 250 - hx, z };
  }
  return { x: 892.5 - hy, y: 250 + hx, z };
}

export function projectHalf(side, hx, hy, z = 0) {
  return project(toWorld(side, hx, hy, z));
}

// Points around a circle in hoop coordinates; angles in degrees, where 90°
// points toward half court.
export function arcPoints(cx, cy, r, from, to, steps = 32) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const angle = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return points;
}

// Floor areas at each end, in hoop coordinates: inside the three-point line,
// the key, and the whole half court.
export const THREE_POINT_AREA = [[-220, -47.5], [-220, 89.5], ...arcPoints(0, 0, 237.5, 157.9, 22.1, 48), [220, 89.5], [220, -47.5]];
export const KEY_AREA = [[-80, -47.5], [-80, 142.5], [80, 142.5], [80, -47.5]];
export const HALF_COURT_AREA = [[-250, -47.5], [250, -47.5], [250, 422.5], [-250, 422.5]];
