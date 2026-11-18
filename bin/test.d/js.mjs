#!/usr/bin/env node
// Runs the JavaScript tests: the package.json "test" script when there is
// one, otherwise Node's built-in runner (node --test), which finds
// *.test.js, *_test.js, test-*.js and files under test/ by itself.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

// npm init's placeholder script, which only fails.
const placeholder = /no test specified/;

if (existsSync("package.json")) {
  const script = JSON.parse(readFileSync("package.json", "utf8")).scripts?.test;

  if (script && !placeholder.test(script)) {
    run("npm", ["test", "--", ...args]);
  }
}

const testFile = /(^|\/)(test\/.*|[^/]*[._-]test|test-[^/]*)\.[cm]?js$/;
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => testFile.test(file));

if (files.length === 0) {
  console.log("no JavaScript tests");
  process.exit(0);
}

run("node", ["--test", ...args]);
