#!/usr/bin/env node
// Lints the JavaScript with ESLint when the project has it installed
// (npm install --save-dev eslint), using the project's eslint.config.js.
// Without it, syntax-checks each tracked file with node --check instead.
// --fix is passed on to ESLint.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const fix = process.argv.includes("--fix");
const eslint = "node_modules/.bin/eslint";

if (existsSync(eslint)) {
  const args = ["."];

  if (fix) {
    args.push("--fix");
  }

  const result = spawnSync(eslint, args, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

const files = execFileSync(
  "git",
  ["ls-files", "-z", "--", "*.js", "*.mjs", "*.cjs"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

if (files.length === 0) {
  console.log("no JavaScript files");
  process.exit(0);
}

console.log(`ESLint is not installed; syntax-checking ${files.length} files with node --check`);

let status = 0;

for (const file of files) {
  const result = spawnSync("node", ["--check", file], { stdio: "inherit" });

  if (result.status !== 0) {
    status = 1;
  }
}

process.exit(status);
