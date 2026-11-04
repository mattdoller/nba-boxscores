import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { arcPoints, CAMERA_TARGET, project, projectHalf, toWorld } from "../../public/lib/court.js";

describe("toWorld", () => {
  it("puts the left hoop 4 ft in from the left baseline, mid-court", () => {
    assert.deepEqual(toWorld("left", 0, 0), { x: 47.5, y: 250, z: 0 });
  });

  it("mirrors the right half", () => {
    assert.deepEqual(toWorld("right", 0, 0), { x: 892.5, y: 250, z: 0 });
    assert.deepEqual(toWorld("left", 100, 50, 10), { x: 97.5, y: 150, z: 10 });
    assert.deepEqual(toWorld("right", 100, 50, 10), { x: 842.5, y: 350, z: 10 });
  });
});

describe("project", () => {
  it("puts the camera's target at the origin, at full size", () => {
    const p = project(CAMERA_TARGET);

    assert.equal(Math.abs(p.x), 0);
    assert.equal(Math.abs(p.y), 0);
    assert.ok(Math.abs(p.scale - 1) < 1e-9);
  });

  it("draws the near sideline bigger and lower than the far one", () => {
    const near = project({ x: 470, y: 500, z: 0 });
    const far = project({ x: 470, y: 0, z: 0 });

    assert.ok(near.scale > 1);
    assert.ok(far.scale < 1);
    assert.ok(near.y > far.y);
  });

  it("draws higher points higher on screen", () => {
    assert.ok(project({ x: 470, y: 250, z: 100 }).y < project(CAMERA_TARGET).y);
  });
});

describe("projectHalf", () => {
  it("draws the two hoops mirrored across center court", () => {
    const left = projectHalf("left", 0, 0);
    const right = projectHalf("right", 0, 0);

    assert.equal(left.x, -right.x);
    assert.equal(left.y, right.y);
  });
});

describe("arcPoints", () => {
  it("runs from the start angle to the end angle", () => {
    const points = arcPoints(0, 0, 10, 0, 90, 2);

    assert.equal(points.length, 3);
    assert.deepEqual(points[0], [10, 0]);
    assert.ok(Math.abs(points[2][0]) < 1e-9);
    assert.equal(points[2][1], 10);
  });
});
