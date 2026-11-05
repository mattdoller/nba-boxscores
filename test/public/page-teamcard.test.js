// The team card: a team's season so far, opened from its name on the
// scoreboard. Its record, its stats ranked against the league's, its games,
// and its hot/cold zones.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SEASON, gameHash, openPage } from "./page.js";

describe("the team card", () => {
  let page;
  let game;
  let season;

  before(async () => {
    page = await openPage({ hash: (fake) => gameHash(fake.byGame.values().next().value) });
    [game] = page.games();
    await page.waitFor(() => page.$(".team-link"), "the scoreboard");
    await page.settle();
  });

  after(() => page.close());

  const dialog = () => page.$("#teamDialog");
  const homeLink = () => page.$$(".scoreboard .team-link")[1];

  it("opens over the game from a team's name on the scoreboard", async () => {
    const link = homeLink();
    const requestsBefore = page.requests.length;
    page.click(link);

    assert.equal(dialog().open, true);
    assert.equal(page.$("#teamDialogTitle").textContent, link.textContent.trim());
    await page.waitFor(() => page.$(".team-game-log") && page.$("#teamDialog .card-court .zone"), "the season");
    await page.settle();

    const query = `team_id=${link.dataset.team}&season=${SEASON}`;
    assert.deepEqual(page.requests.slice(requestsBefore).sort(), [`/api/team?${query}`, `/api/teamzones?${query}`]);
    season = await page.api(`/api/team?${query}`);
  });

  it("lists every game, marking the one on screen", () => {
    const rows = page.$$(".team-game-log tbody tr");
    assert.deepEqual(rows.map((row) => row.dataset.date), season.games.map((g) => g.date));
    const current = page.$(".team-game-log tr.current");
    assert.equal(current.dataset.date, game.date);
    assert.match(current.textContent, new RegExp(`${game.score.home}–${game.score.away}`));
  });

  it("shows the record, and where the team stood after this game", () => {
    const wins = season.games.filter((g) => g.result === "W").length;
    const line = page.$(".team-record").textContent;
    assert.match(line, new RegExp(`^${wins}–${season.games.length - wins}`));
    assert.match(line, /Home \d+–\d+ · Away \d+–\d+ · Streak [WL]\d+/);
    const first = season.games[0].result === "W" ? "1–0" : "0–1";
    assert.match(line, new RegExp(`${first} after this game`));
  });

  it("ranks each stat against the league, and shades it", () => {
    const rows = page.$$(".team-stats-table tbody tr");
    assert.equal(rows.length, 14);
    const own = season.teams.find((t) => t.team_id === season.team.id);
    const points = rows.find((row) => row.cells[0].textContent === "Points");
    assert.equal(points.cells[1].textContent, (own.pts / own.gp).toFixed(1));
    for (const row of rows) {
      const rank = Number(row.cells[2].textContent.replace(/\D/g, ""));
      assert.ok(rank >= 1 && rank <= season.teams.length, `${row.cells[0].textContent} ranked ${rank}`);
      assert.match(row.cells[1].title, /^League average/);
    }
    // Only the league's highest-scoring team ranks first in points.
    const ppg = season.teams.map((t) => t.pts / t.gp);
    assert.equal(points.cells[2].textContent === "1st", own.pts / own.gp === Math.max(...ppg));
  });

  it("shows the team's zones for the season", () => {
    assert.ok(page.$$("#teamDialog .card-court .zone").length > 10);
    assert.match(page.$("#teamDialog .legend").textContent, /\d+ shots/);

    const zone = "Restricted Area|Center(C)";
    page.hover(page.$(`#teamDialog .card-court .zone[data-zone="${zone}"]`));
    assert.deepEqual(page.$$("#teamDialog .zone-list tr.zone-hover").map((row) => row.dataset.zone), [zone]);
    dialog().dispatchEvent(new page.window.MouseEvent("mouseleave"));
    assert.equal(page.$$("#teamDialog .zone-list tr.zone-hover").length, 0);
  });

  it("opens another of the team's games from the log", async () => {
    const next = season.games[1];
    page.click(page.$(`.team-game-log tr[data-date="${next.date}"] td`));

    assert.equal(dialog().open, false);
    await page.waitFor(() => page.hash().get("date") === next.date && page.$(".scoreboard")?.textContent.includes(String(next.pts)), "the game");
    await page.settle();
    assert.equal(page.hash().get("team"), season.team.abbreviation);
  });

  it("sorts the season's stats by rank, and remembers it the next time", async () => {
    page.click(homeLink());
    await page.waitFor(() => page.$(".team-stats-table"), "the season");
    const ranks = () => page.$$(".team-stats-table tbody tr").map((row) => Number.parseInt(row.cells[2].textContent));
    const rankButton = () => page.$$(".team-stats-table thead .sort").find((b) => b.textContent === "Rank");

    page.click(rankButton());
    assert.deepEqual(ranks(), [...ranks()].sort((a, b) => a - b), "best first");
    assert.equal(rankButton().closest("th").getAttribute("aria-sort"), "ascending");

    page.click("#teamDialog .player-card-close");
    page.click(homeLink());
    await page.waitFor(() => page.$(".team-stats-table"), "the season");
    assert.deepEqual(ranks(), [...ranks()].sort((a, b) => a - b));
  });

  it("closes from its close button", () => {
    page.click("#teamDialog .player-card-close");
    assert.equal(dialog().open, false);
  });

  it("raises no errors", () => {
    assert.deepEqual(page.errors, []);
  });
});
