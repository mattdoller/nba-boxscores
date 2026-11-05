// The player card: a player's career, shaded against the league, and their
// hot/cold zones by season, opened from a name in a box score.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { gameHash, openPage } from "./page.js";

describe("the player card", () => {
  let page;
  let player;
  let career;

  before(async () => {
    page = await openPage({ hash: (fake) => gameHash(fake.byGame.values().next().value) });
    await page.waitFor(() => page.$(".player-link"), "the box score");
    await page.settle();
    // A veteran, so the card has seasons to compare and pick from.
    for (const link of page.$$(".player-link")) {
      const data = await page.api(`/api/player?player_id=${link.dataset.player}`);
      if (data.seasons.length >= 3) {
        player = link;
        career = data;
        break;
      }
    }
  });

  after(() => page.close());

  const dialog = () => page.$("#playerDialog");
  const seasonRows = () => page.$$("#playerDialog .career tbody tr[data-season]");

  it("opens over the game from a player's name", async () => {
    const requestsBefore = page.requests.length;
    page.click(player);

    assert.equal(dialog().open, true);
    assert.equal(page.$("#playerDialogTitle").textContent, player.textContent.trim());
    await page.waitFor(() => seasonRows().length > 0 && page.$$(".career td[style]").length > 0, "the career and its shading");
    await page.settle();

    const requested = page.requests.slice(requestsBefore).map((r) => r.split("?")[0]);
    assert.deepEqual(requested.sort(), ["/api/league", "/api/player", "/api/playerzones"]);
  });

  it("lists every season, then the career", () => {
    assert.deepEqual(seasonRows().map((row) => Number(row.dataset.season)), career.seasons.map((s) => s.season));
    assert.match(page.$("#playerDialog .career tfoot").textContent, /Career/);
  });

  it("shades stats against the league, and explains the colors", () => {
    const shaded = page.$$("#playerDialog .career td[style]");
    assert.ok(shaded.length > 0);
    assert.ok(shaded.every((td) => /color-mix/.test(td.getAttribute("style")) && td.title), "each shaded cell says why");
    assert.match(page.$("#playerDialog .hint").textContent, /red above average/);
  });

  it("turns the shading off, and remembers it", () => {
    page.click("#cardShading");

    assert.equal(page.$$("#playerDialog .career td[style]").length, 0);
    assert.equal(page.pref("cardShading"), false);

    page.click("#cardShading");
    assert.ok(page.$$("#playerDialog .career td[style]").length > 0);
  });

  it("switches between per-game averages and season totals", () => {
    const points = () => seasonRows()[0].cells[[...page.$$("#playerDialog .career thead th")].findIndex((th) => th.textContent === "PTS")].textContent;
    const perGame = Number(points());

    page.click('[data-card-mode="totals"]');

    assert.equal(Number(points().replace(/,/g, "")), Math.round(career.seasons[0].pts));
    assert.ok(Number(points().replace(/,/g, "")) > perGame);
    assert.equal(page.pref("cardMode"), "totals");
    page.click('[data-card-mode="perGame"]');
  });

  it("shows more stats, and fewer again", () => {
    const columns = () => page.$$("#playerDialog .career thead th").length;
    const fewer = columns();

    page.click("#cardExpand");
    assert.ok(columns() > fewer);
    assert.ok(dialog().classList.contains("expanded"));
    assert.equal(page.$("#cardExpand").getAttribute("aria-pressed"), "true");

    page.click("#cardExpand");
    assert.equal(columns(), fewer);
  });

  it("shows the latest season's zones on a court and in a list", () => {
    const latest = career.seasons.at(-1).season;
    assert.equal(Number(page.$("#cardZoneSeason").value), latest);
    assert.ok(page.$$(".card-court .zone").length > 10);
    assert.equal(page.$$(".zone-list tr[data-zone]").length, 14);
    assert.ok(seasonRows().find((row) => Number(row.dataset.season) === latest).classList.contains("picked"));
  });

  it("shows another season's zones when its row is clicked", async () => {
    const first = career.seasons[0].season;
    page.click(seasonRows()[0].cells[0]);

    await page.waitFor(() => Number(page.$("#cardZoneSeason")?.value) === first && !/Loading/.test(page.$(".card-zones").textContent), "the season's zones");
    assert.ok(seasonRows()[0].classList.contains("picked"));
  });

  it("marks a zone on the court and in the list together", () => {
    const zone = "Restricted Area|Center(C)";
    page.hover(page.$(`.card-court .zone[data-zone="${zone}"]`));

    assert.equal(page.$(".card-court .zone-outline").dataset.key, `|${zone}`);
    assert.deepEqual(page.$$(".zone-list tr.zone-hover").map((row) => row.dataset.zone), [zone]);

    const other = "Left Corner 3|Left Side(L)";
    page.hover(page.$(`.zone-list tr[data-zone="${other}"] th`));
    assert.equal(page.$(".card-court .zone-outline").dataset.key, `|${other}`);
    assert.deepEqual(page.$$(".zone-list tr.zone-hover").map((row) => row.dataset.zone), [other]);

    dialog().dispatchEvent(new page.window.MouseEvent("mouseleave"));
    assert.equal(page.$$(".zone-list tr.zone-hover").length, 0);
    assert.equal(page.$(".card-court .zone-outline").children.length, 0);
  });

  it("sorts the career by a column, keeps it as the card redraws, and remembers it", () => {
    const column = () => [...page.$$("#playerDialog .career thead th")].findIndex((th) => th.textContent === "PTS");
    const points = () => seasonRows().map((row) => Number(row.cells[column()].textContent));
    const sortButton = () => page.$$("#playerDialog .career thead .sort").find((b) => b.textContent === "PTS");

    page.click(sortButton());
    assert.deepEqual(points(), [...points()].sort((a, b) => b - a));
    assert.equal(sortButton().closest("th").getAttribute("aria-sort"), "descending");

    page.click(sortButton());
    assert.deepEqual(points(), [...points()].sort((a, b) => a - b));

    // A redraw, like turning the shading off and on, keeps the order.
    page.click("#cardShading");
    page.click("#cardShading");
    assert.deepEqual(points(), [...points()].sort((a, b) => a - b));
    assert.deepEqual(page.pref("cardSorts").career, { col: column(), dir: "asc" });
    assert.match(page.$("#playerDialog .career tfoot").textContent, /Career/, "the career row stays at the bottom");

    // Season puts it back in order.
    page.click(page.$$("#playerDialog .career thead .sort")[0]);
    assert.deepEqual(seasonRows().map((row) => Number(row.dataset.season)), career.seasons.map((s) => s.season));
  });

  it("sorts the zone list, with empty zones last either way", () => {
    const sortButton = () => page.$$("#playerDialog .zone-list thead .sort").find((b) => b.textContent === "FG%");
    const values = () => page.$$("#playerDialog .zone-list tbody tr").map((row) => row.cells[2].textContent);
    const shot = () => values().filter((v) => v !== "–").map(Number);

    page.click(sortButton());
    assert.deepEqual(shot(), [...shot()].sort((a, b) => b - a));
    assert.ok(values().slice(shot().length).every((v) => v === "–"));

    page.click(sortButton());
    assert.deepEqual(shot(), [...shot()].sort((a, b) => a - b));
    assert.ok(values().slice(shot().length).every((v) => v === "–"));
  });

  it("closes from its close button", () => {
    page.click(".player-card-close");
    assert.equal(dialog().open, false);
  });

  it("raises no errors", () => {
    assert.deepEqual(page.errors, []);
  });
});
