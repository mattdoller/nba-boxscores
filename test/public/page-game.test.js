// A game's page: the scoreboard, box scores, shot chart, play-by-play, and
// scoring trend, and the controls that filter and sort them.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { gameHash, openPage } from "./page.js";

describe("a game's page", () => {
  let page;
  let game;
  let box;
  let shots;
  let plays;

  before(async () => {
    page = await openPage({ hash: (fake) => gameHash(fake.byGame.values().next().value), fixtures: true });
    [game] = page.games();
    await page.waitFor(() => page.$(".shotchart .shot") && page.$(".pbp"), "the game to load");
    await page.settle();
    box = await page.api(`/api/boxscore?game_id=${game.id}&date=${game.date}`);
    shots = await page.api(`/api/shotchart?game_id=${game.id}`);
    plays = await page.api(`/api/playbyplay?game_id=${game.id}`);
  });

  after(() => page.close());

  const allShots = () => Object.values(shots).flat();
  const pbpRows = () => page.$$("#playbyplay tr[data-play]");

  it("loads the game in the URL with one request per part", () => {
    assert.deepEqual(page.requests.filter((r) => !r.startsWith("/api/teams") && !r.startsWith("/api/info")), [
      `/api/games?team_id=${box.game.home.id}&season=2025`,
      `/api/boxscore?game_id=${game.id}&date=${game.date}`,
      `/api/shotchart?game_id=${game.id}`,
      `/api/playbyplay?game_id=${game.id}`,
      `/api/lineups?game_id=${game.id}`,
    ]);
    assert.equal(page.$("#teamSelect").selectedOptions[0].dataset.abbr, game.home);
    assert.equal(page.$("#seasonSelect").value, "2025");
  });

  it("shows the final score and line score", () => {
    const scoreboard = page.$(".scoreboard").textContent;
    assert.match(scoreboard, new RegExp(`${game.away}[\\s\\S]*${game.score.away}[\\s\\S]*${game.home}[\\s\\S]*${game.score.home}`));
    const totals = page.$$(".linescore tbody tr").map((row) => row.cells[row.cells.length - 1].textContent.trim());
    assert.deepEqual(totals, [String(game.score.away), String(game.score.home)]);
  });

  it("says the data is made up, and offers only seasons it has", () => {
    assert.match(page.$(".test-data-notice").textContent, /made up/);
    assert.deepEqual([...page.$("#seasonSelect").options].map((o) => o.value), ["2025"]);
  });

  it("lists each team's players, most minutes first", () => {
    const tables = page.$$("table.stats[data-team]");
    assert.equal(tables.length, 2);
    for (const table of tables) {
      const teamId = Number(table.dataset.team);
      const played = box.stats.filter((p) => p.team_id === teamId && p.min);
      const names = [...table.querySelectorAll("tbody .player-link")].map((link) => link.textContent.trim());
      assert.ok(names.length >= played.length, `${names.length} rows for ${played.length} players`);
      const minutes = [...table.querySelectorAll("tbody tr")].slice(0, played.length)
        .map((row) => row.cells[1].textContent.split(":").reduce((m, s) => Number(m) * 60 + Number(s)));
      assert.deepEqual(minutes, [...minutes].sort((a, b) => b - a));
    }
  });

  it("sorts a box score by a column, and reverses on a second click", () => {
    const table = page.$("table.stats[data-team]");
    const points = () => [...table.querySelectorAll("tbody tr")].map((row) => Number(row.cells[2].textContent)).filter((n) => !Number.isNaN(n));

    page.click(table.querySelector('.sort[data-sort="pts"]'));
    assert.deepEqual(points(), [...points()].sort((a, b) => b - a));
    assert.equal(table.querySelector('th[aria-sort="descending"] .sort').dataset.sort, "pts");

    page.click(table.querySelector('.sort[data-sort="pts"]'));
    assert.deepEqual(points(), [...points()].sort((a, b) => a - b));

    const side = Object.keys(page.pref("sorts"))[0];
    assert.deepEqual(page.pref("sorts")[side], { key: "pts", dir: "asc" });
  });

  it("puts every shot on the court", () => {
    assert.equal(page.$$("#shotcharts .shot").length, allShots().length);
    assert.equal(page.$$("#shotcharts .shot.made").length, allShots().filter((s) => s.made).length);
  });

  it("shows every play beside the court", () => {
    assert.equal(pbpRows().length, plays.length);
  });

  it("draws the scoring trend", () => {
    assert.ok(page.$("#scoretrend svg .trend-line"));
  });

  it("lists each team's lineups, most-used first, accounting for the whole game", async () => {
    await page.waitFor(() => page.$(".lineups-table"), "the lineups");
    const lineups = await page.api(`/api/lineups?game_id=${game.id}`);
    const tables = page.$$("#lineups .team-lineups");
    assert.equal(tables.length, 2);

    for (const section of tables) {
      const teamId = Number(section.dataset.team);
      const units = lineups.teams[teamId];
      const rows = [...section.querySelectorAll("tbody tr")];
      assert.equal(rows.length, Math.min(units.length, 10));
      const seconds = rows.map((row) => Number(row.cells[1].dataset.value));
      assert.deepEqual(seconds, [...seconds].sort((a, b) => b - a));
      // Every unit together played the whole game, and outscored the
      // other team by the final margin.
      const total = units.reduce((sum, u) => sum + u.seconds, 0);
      const periods = page.$$(".linescore thead th").length - 2;
      assert.ok(Math.abs(total - (2880 + (periods - 4) * 300)) < 1, `${total} seconds over ${periods} periods`);
      const margin = units.reduce((sum, u) => sum + u.pts_for - u.pts_against, 0);
      const own = teamId === box.game.home.id ? game.score.home - game.score.away : game.score.away - game.score.home;
      assert.equal(margin, own);
    }
  });

  it("shows every lineup on request, and sorts them", () => {
    const button = page.$(".show-lineups");
    const teamId = Number(button.dataset.team);
    page.click(button);

    const section = page.$(`.team-lineups[data-team="${teamId}"]`);
    const net = () => [...section.querySelectorAll("tbody tr")].map((row) => Number(row.cells[4].textContent));
    assert.match(page.$(`.show-lineups[data-team="${teamId}"]`).textContent, /Show fewer/);
    assert.ok(net().length > 10);

    page.click([...section.querySelectorAll("thead .sort")].find((b) => b.textContent === "+/-"));
    assert.deepEqual(net(), [...net()].sort((a, b) => b - a));
  });

  it("filters the court and play-by-play to a quarter", async () => {
    page.click('#periodTabs button[data-period="2"]');

    assert.equal(page.hash().get("q"), "Q2");
    assert.equal(page.$('#periodTabs button[aria-pressed="true"]').dataset.period, "2");
    assert.equal(pbpRows().length, plays.filter((p) => p.period === 2).length);
    const q2 = allShots().filter((s) => s.period === 2).length;
    assert.equal(page.$$("#shotcharts .shot").length, q2);

    page.click('#periodTabs button[data-period="all"]');
    assert.equal(page.hash().get("q"), null);
    assert.equal(pbpRows().length, plays.length);
  });

  it("filters the court to the players picked", () => {
    const [shooter] = allShots();
    page.click("#playerButton");
    page.change(`#playerMenu input[value="${shooter.player_id}"]`, true);

    assert.equal(page.hash().get("players"), String(shooter.player_id));
    const theirs = allShots().filter((s) => s.player_id === shooter.player_id).length;
    assert.equal(page.$$("#shotcharts .shot").length, theirs);
    assert.match(page.$("#playerButton").textContent, new RegExp(shooter.player.split(" ").at(-1)));

    page.click("#playerMenu .show-all");
    assert.equal(page.hash().get("players"), null);
    assert.equal(page.$$("#shotcharts .shot").length, allShots().length);
  });

  it("shades hot and cold zones once switched on, and remembers it", async () => {
    assert.equal(page.$$("#shotcharts .zone").length, 0);

    page.change("#zonesToggle", true);
    await page.waitFor(() => page.$$("#shotcharts .zone").length > 0, "the zones");

    assert.equal(page.pref("zones"), true);
    assert.ok(page.$$('#shotcharts .zone[style*="color-mix"]').length > 0, "some zones are shaded");
  });

  it("outlines a hovered zone and explains it in a tooltip", () => {
    const zone = page.$('#shotcharts .zone[style*="color-mix"]');
    page.hover(zone);

    const outline = page.$("#shotcharts .zone-outline");
    assert.equal(outline.dataset.key, `${zone.dataset.team}|${zone.dataset.zone}`);
    assert.ok(outline.querySelector("mask"));
    assert.equal(page.$(".tooltip").hidden, false);
    assert.match(page.$(".tooltip").textContent, /League/);

    page.$("#boxscore").dispatchEvent(new page.window.MouseEvent("mouseleave"));
    assert.equal(outline.children.length, 0);
    assert.equal(page.$(".tooltip").hidden, true);
  });

  it("folds the play-by-play away and remembers it", () => {
    page.click("#pbpToggle");

    assert.equal(page.$("#playbyplay").hidden, true);
    assert.equal(page.$("#pbpToggle").getAttribute("aria-expanded"), "false");
    assert.equal(page.pref("pbpCollapsed"), true);

    page.click("#pbpToggle");
    assert.equal(page.$("#playbyplay").hidden, false);
  });

  it("switches between day and night without redrawing the court", () => {
    const court = page.$("#shotcharts svg");
    const before = page.document.documentElement.dataset.theme;

    page.click("#themeToggle");

    assert.notEqual(page.document.documentElement.dataset.theme, before);
    assert.equal(page.window.localStorage.getItem("theme"), page.document.documentElement.dataset.theme);
    assert.equal(page.$("#shotcharts svg"), court);
  });

  it("folds the control panel away and remembers it", () => {
    page.click("#panelToggle");

    assert.equal(page.document.documentElement.dataset.panel, "collapsed");
    assert.equal(page.window.localStorage.getItem("panel"), "collapsed");

    page.click("#panelToggle");
    assert.equal(page.document.documentElement.dataset.panel, undefined);
  });

  it("reports what the user did", () => {
    const names = new Set(page.tracked.map((event) => event.name));
    for (const name of ["box_score_sort", "period_select", "zones_toggle", "pbp_toggle", "theme_toggle", "panel_toggle"]) {
      assert.ok(names.has(name), `tracked ${name}`);
    }
  });

  it("raises no errors", () => {
    assert.deepEqual(page.errors, []);
  });
});
