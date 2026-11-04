// Lint rules for the whole project; run them with bin/lint. On top of
// ESLint's recommended checks for likely mistakes, these keep the house
// style: double quotes, semicolons, trailing commas on multiline lists,
// braces on every if, and 2-space indents.
import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/", "data/", "coverage/"],
  },
  js.configs.recommended,
  {
    plugins: { "@stylistic": stylistic },
    rules: {
      curly: ["error", "all"],
      // `x == null` deliberately matches both null and undefined.
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "error",
      "@stylistic/arrow-parens": ["error", "always"],
      "@stylistic/brace-style": ["error", "1tbs"],
      "@stylistic/comma-dangle": ["error", "always-multiline"],
      "@stylistic/comma-spacing": "error",
      "@stylistic/eol-last": "error",
      "@stylistic/indent": ["error", 2],
      "@stylistic/keyword-spacing": "error",
      "@stylistic/no-trailing-spaces": "error",
      "@stylistic/object-curly-spacing": ["error", "always"],
      "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
      "@stylistic/semi": ["error", "always"],
      "@stylistic/space-before-blocks": "error",
      "@stylistic/space-infix-ops": "error",
    },
  },
  // The server, its API client, scripts, and tests run on Node. The bin/
  // scripts have no .js extension, so they're named here to be linted.
  {
    files: ["*.js", "nba-api/**/*.js", "dev/**/*.js", "test/**/*.js", "bin/cache", "bin/backfill", "bin/load-fixtures"],
    languageOptions: { globals: globals.node },
  },
  // The front end runs in the browser. events.js is a classic script that
  // defines track() for app.js, which also uses flatpickr from its CDN script.
  {
    files: ["public/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["public/events.js"],
    languageOptions: { sourceType: "script" },
    rules: {
      // track() and describeTarget() are used by app.js and the tests.
      "no-unused-vars": ["error", { varsIgnorePattern: "^(track|describeTarget)$" }],
    },
  },
  {
    files: ["public/app.js"],
    languageOptions: { globals: { flatpickr: "readonly", track: "readonly" } },
  },
];
