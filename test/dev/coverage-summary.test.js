import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coverageTable } from "../../dev/coverage-summary.js";

const REPORT = `
✔ some test (1ms)
ℹ start of coverage report
ℹ --------------------------------------------------------------
ℹ file          | line % | branch % | funcs % | uncovered lines
ℹ --------------------------------------------------------------
ℹ lineups.js    |  97.24 |    90.00 |  100.00 | 25-26 57-58
ℹ nba-api       |        |          |         |
ℹ  cache.js     |  95.95 |    95.65 |   93.33 | 139-145
ℹ  endpoints    |        |          |         |
ℹ   teams.js    | 100.00 |   100.00 |  100.00 |
ℹ server.js     |  94.97 |    86.41 |   96.15 | 10-12
ℹ --------------------------------------------------------------
ℹ all files     |  87.60 |    87.18 |   92.33 |
ℹ --------------------------------------------------------------
ℹ end of coverage report
`;

describe("coverageTable", () => {
  it("lists each file by its path, then the total", () => {
    // Past the header and the line under it.
    const rows = coverageTable(REPORT).split("\n").filter((line) => line.startsWith("| ")).slice(2);

    assert.deepEqual(rows, [
      "| lineups.js | 97.24 | 90.00 | 100.00 |",
      "| nba-api/cache.js | 95.95 | 95.65 | 93.33 |",
      "| nba-api/endpoints/teams.js | 100.00 | 100.00 | 100.00 |",
      "| server.js | 94.97 | 86.41 | 96.15 |",
      "| **All files** | 87.60 | 87.18 | 92.33 |",
    ]);
  });

  it("says so when there's no report", () => {
    assert.match(coverageTable("✔ some test (1ms)\n"), /No coverage report/);
  });
});
