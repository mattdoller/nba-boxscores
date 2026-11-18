#!/usr/bin/env node
// Starts the JavaScript development server: the package.json "dev" script
// (Vite and most frameworks), else its "start" script, else server.js,
// server.mjs or index.js with node --watch so it restarts on changes.
// Arguments are passed on.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);

function run(command, commandArgs) {
  const child = spawn(command, commandArgs, { stdio: "inherit" });

  // Pass a stop on to the server and exit once it has.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
    }

    process.exit(code ?? 1);
  });
}

let scripts = {};

if (existsSync("package.json")) {
  scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
}

const script = ["dev", "start"].find((name) => scripts[name]);
const entry = ["server.js", "server.mjs", "index.js"].find((file) => existsSync(file));

if (script) {
  run("npm", ["run", script, "--", ...args]);
} else if (entry) {
  run("node", ["--watch", entry, ...args]);
} else {
  console.error('no JavaScript server: add a "dev" or "start" script to package.json, or a server.js');
  process.exit(1);
}
