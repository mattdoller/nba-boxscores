import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { minutes, minuteSeconds, sortPlayers, sortValue } from "../../public/lib/stats.js";

function player(fields) {
  return { team_id: 1, recorded: true, min: "20:00", first_name: "A", last_name: "Player", ...fields };
}

describe("minutes", () => {
  it("is the whole minutes played", () => {
    assert.equal(minutes({ min: "34:59" }), 34);
  });

  it("is 0 without a time", () => {
    assert.equal(minutes({ min: null }), 0);
  });
});

describe("minuteSeconds", () => {
  it("counts the seconds too", () => {
    assert.equal(minuteSeconds({ min: "34:12" }), 2052);
  });

  it("is 0 without a time", () => {
    assert.equal(minuteSeconds({}), 0);
  });
});

describe("sortValue", () => {
  it("sorts players by last name, then first", () => {
    assert.equal(sortValue({ first_name: "Jayson", last_name: "Tatum" }, "player"), "tatum jayson");
  });

  it("sorts minutes by their seconds", () => {
    assert.equal(sortValue({ min: "1:30" }, "min"), 90);
  });

  it("sorts shooting by makes, then fewer attempts", () => {
    const fewer = sortValue({ fgm: 8, fga: 15 }, "fg");
    const more = sortValue({ fgm: 8, fga: 17 }, "fg");
    const better = sortValue({ fgm: 9, fga: 30 }, "fg");

    assert.ok(fewer > more);
    assert.ok(better > fewer);
  });

  it("puts missing stats last", () => {
    assert.equal(sortValue({}, "pts"), -Infinity);
  });
});

describe("sortPlayers", () => {
  const rows = [
    player({ last_name: "Bench", pts: 4, min: "10:00" }),
    player({ last_name: "Star", pts: 30, min: "36:00" }),
    player({ last_name: "Starter", pts: 4, min: "30:00" }),
    player({ last_name: "Other", team_id: 2, pts: 50 }),
    player({ last_name: "Unused", pts: 0, min: "0:00" }),
    player({ last_name: "Missing", recorded: false, pts: 99 }),
  ];

  it("keeps the team's players who played", () => {
    const names = sortPlayers(rows, 1, { key: "pts", dir: "desc" }).map((r) => r.last_name);

    assert.deepEqual(names.sort(), ["Bench", "Star", "Starter"]);
  });

  it("sorts by the key in either direction, ties by minutes", () => {
    const desc = sortPlayers(rows, 1, { key: "pts", dir: "desc" }).map((r) => r.last_name);
    const asc = sortPlayers(rows, 1, { key: "pts", dir: "asc" }).map((r) => r.last_name);

    assert.deepEqual(desc, ["Star", "Starter", "Bench"]);
    assert.deepEqual(asc, ["Starter", "Bench", "Star"]);
  });

  it("sorts names alphabetically", () => {
    const names = sortPlayers(rows, 1, { key: "player", dir: "asc" }).map((r) => r.last_name);

    assert.deepEqual(names, ["Bench", "Star", "Starter"]);
  });
});
