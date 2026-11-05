// Turns the coverage report `bin/test --coverage` prints into a Markdown
// table, for the CI run's summary page: one row per file, by its path, with
// its line, branch, and function coverage, and the total last.
//
//   bin/test --coverage | node dev/coverage-summary.js >> "$GITHUB_STEP_SUMMARY"

import { text } from "node:stream/consumers";

// The report's rows: "ℹ  cache.js | 95.95 | 95.65 | 93.33 | 139-145". Files
// are indented a space per directory under the one listed above them, and
// directories have no numbers.
export function coverageTable(output) {
  const lines = output.split("\n");
  const start = lines.findIndex((line) => line.includes("start of coverage report"));
  const end = lines.findIndex((line) => line.includes("end of coverage report"));
  if (start === -1 || end === -1) {
    return "No coverage report in the test output.\n";
  }

  const rows = [];
  const dirs = [];
  for (const line of lines.slice(start + 1, end)) {
    const body = line.replace(/^ℹ /, "");
    if (!body.includes("|")) {
      continue;
    }
    const [name, linePct, branchPct, funcsPct] = body.split("|");
    if (name.trim() === "file") {
      continue;
    }
    const depth = name.length - name.trimStart().length;
    dirs.length = depth;
    if (!linePct.trim()) {
      dirs[depth] = name.trim();
      continue;
    }
    const path = name.trim() === "all files" ? "**All files**" : [...dirs, name.trim()].join("/");
    rows.push(`| ${path} | ${linePct.trim()} | ${branchPct.trim()} | ${funcsPct.trim()} |`);
  }
  return ["### Test coverage", "", "| File | Lines % | Branches % | Functions % |", "| --- | --: | --: | --: |", ...rows, ""].join("\n");
}

if (import.meta.main) {
  process.stdout.write(coverageTable(await text(process.stdin)));
}
