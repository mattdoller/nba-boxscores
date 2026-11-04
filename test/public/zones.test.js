import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ZONE_FULL_SHADE,
  ZONE_LAYERS,
  ZONE_NAMES,
  wedge,
  zoneAt,
  zoneComparison,
  zoneTotals,
} from "../../public/lib/zones.js";

describe("wedge", () => {
  it("starts at the hoop and sweeps from one angle to the other", () => {
    const points = wedge(-18, 18, 100);

    assert.deepEqual(points[0], [0, 0]);
    // -18° is toward the left (negative x), on the way out to half court.
    assert.ok(points[1][0] < 0 && points[1][1] > 0);
    assert.ok(points.at(-1)[0] > 0 && points.at(-1)[1] > 0);
  });
});

describe("ZONE_LAYERS", () => {
  it("only draws stats.nba.com's zones, and all of them", () => {
    assert.deepEqual(new Set(ZONE_LAYERS.map((l) => l.zone)), new Set(Object.keys(ZONE_NAMES)));
  });
});

describe("zoneAt", () => {
  // Shot locations (LOC_X, LOC_Y) and the zone stats.nba.com put them in.
  const shots = [
    [0, 10, "Restricted Area|Center(C)"],
    [0, 100, "In The Paint (Non-RA)|Center(C)"],
    [-70, 60, "In The Paint (Non-RA)|Left Side(L)"],
    [70, 60, "In The Paint (Non-RA)|Right Side(R)"],
    [0, 150, "Mid-Range|Center(C)"],
    [0, 200, "Mid-Range|Center(C)"],
    [-120, 150, "Mid-Range|Left Side Center(LC)"],
    [120, 150, "Mid-Range|Right Side Center(RC)"],
    [-200, 20, "Mid-Range|Left Side(L)"],
    [-130, 60, "Mid-Range|Left Side(L)"],
    [200, 20, "Mid-Range|Right Side(R)"],
    [-235, 0, "Left Corner 3|Left Side(L)"],
    [235, 0, "Right Corner 3|Right Side(R)"],
    [0, 300, "Above the Break 3|Center(C)"],
    [-200, 250, "Above the Break 3|Left Side Center(LC)"],
    [200, 250, "Above the Break 3|Right Side Center(RC)"],
  ];

  for (const [x, y, zone] of shots) {
    it(`puts (${x}, ${y}) in ${zone}`, () => {
      assert.equal(zoneAt(x, y), zone);
    });
  }

  it("has no zone in the backcourt", () => {
    assert.equal(zoneAt(0, 450), null);
  });
});

describe("zoneTotals", () => {
  it("counts makes and attempts by zone, skipping shots outside the zones", () => {
    const totals = zoneTotals([
      { zone: "Mid-Range|Center(C)", made: true },
      { zone: "Mid-Range|Center(C)", made: false },
      { zone: "Restricted Area|Center(C)", made: true },
      { zone: "Backcourt|Back Court(BC)", made: true },
      { zone: null, made: true },
    ]);

    assert.deepEqual(totals, {
      "Mid-Range|Center(C)": { fgm: 1, fga: 2 },
      "Restricted Area|Center(C)": { fgm: 1, fga: 1 },
    });
  });
});

describe("zoneComparison", () => {
  it("is the difference from the league's percentage", () => {
    const { diff, strength } = zoneComparison({ fgm: 5, fga: 10 }, { fgm: 45, fga: 100 });

    assert.ok(Math.abs(diff - 0.05) < 1e-9);
    assert.ok(Math.abs(strength - 0.05 / ZONE_FULL_SHADE) < 1e-9);
  });

  it("is negative for worse shooting, and tops out at full strength", () => {
    const { diff, strength } = zoneComparison({ fgm: 0, fga: 4 }, { fgm: 60, fga: 100 });

    assert.equal(diff, -0.6);
    assert.equal(strength, 1);
  });

  it("is null without attempts or league numbers", () => {
    assert.equal(zoneComparison(undefined, { fgm: 1, fga: 2 }), null);
    assert.equal(zoneComparison({ fgm: 0, fga: 0 }, { fgm: 1, fga: 2 }), null);
    assert.equal(zoneComparison({ fgm: 1, fga: 2 }, undefined), null);
  });
});
