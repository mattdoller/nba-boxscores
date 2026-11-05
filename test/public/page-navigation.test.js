// Getting to a game: coming back to the last one seen, the calendar, the
// team and season menus, and links that set the page's state in the URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SEASON, openPage } from "./page.js";

describe("getting to a game", () => {
  let page;
  let games;
  let team;
  let teamGames;

  before(async () => {
    page = await openPage();
    games = page.games();
    team = games[0].home;
    teamGames = games.filter((g) => g.home === team || g.away === team);
  });

  after(() => page.close());

  const shownDate = () => page.$(".scoreboard")?.textContent.match(/\w{3}, \w{3} \d+, \d{4}/)?.[0];
  const openHash = async (hash) => {
    page.window.location.hash = hash;
    await page.waitFor(() => page.window.location.hash !== "" || hash === "", "the hash");
    await page.settle();
  };

  it("starts with nothing picked", () => {
    assert.equal(page.$("#teamSelect").value, "");
    assert.match(page.$("#calendarHint").textContent, /Choose a team/);
    assert.equal(page.$("#boxscore").textContent.trim(), "");
  });

  it("lists a team's games on the calendar once it's picked", async () => {
    page.change("#seasonSelect", String(SEASON));
    await page.settle();
    const option = [...page.$("#teamSelect").options].find((o) => o.dataset.abbr === team);
    page.change("#teamSelect", option.value);
    await page.settle();

    assert.deepEqual(page.calendar().config.enable, teamGames.map((g) => g.date));
    assert.match(page.$("#calendarHint").textContent, new RegExp(`${teamGames.length} games played`));
    assert.equal(page.hash().get("team"), team);
    assert.equal(page.hash().get("season"), String(SEASON));
  });

  it("opens the game on a date picked on the calendar", async () => {
    page.calendar().pick(teamGames[1].date);
    await page.waitFor(() => page.$(".shotchart .shot"), "the game");
    await page.settle();

    assert.equal(page.hash().get("date"), teamGames[1].date);
    assert.equal(new Date(shownDate()).toDateString(), new Date(`${teamGames[1].date}T12:00`).toDateString());
    assert.equal(page.pref("lastView"), page.window.location.hash.slice(1));
  });

  it("follows a link's quarter and players", async () => {
    const game = teamGames[0];
    const shots = Object.values(await page.api(`/api/shotchart?game_id=${game.id}`)).flat();
    const player = shots.find((s) => s.period === 2).player_id;

    await openHash(`#team=${team}&season=${SEASON}&date=${game.date}&q=Q2&players=${player}`);
    await page.waitFor(() => page.hash().get("date") === game.date && page.$("#shotcharts .shot"), "the linked game");

    assert.equal(page.$('#periodTabs button[aria-pressed="true"]').dataset.period, "2");
    const expected = shots.filter((s) => s.period === 2 && s.player_id === player).length;
    assert.equal(page.$$("#shotcharts .shot").length, expected);
    assert.equal(page.hash().get("players"), String(player));
  });

  it("drops what a link gets wrong, and keeps the rest", async () => {
    await openHash(`#team=${team}&season=${SEASON}&date=1999-01-01`);

    assert.equal(page.hash().get("team"), team);
    assert.equal(page.hash().get("date"), null);
    assert.equal(page.$("#boxscore").textContent.trim(), "");
  });

  it("clears the game when the season changes", async () => {
    page.calendar().pick(teamGames[0].date);
    await page.waitFor(() => page.$(".shotchart .shot"), "the game");
    await page.settle();

    page.change("#seasonSelect", String(SEASON - 1));
    await page.settle();

    assert.equal(page.hash().get("season"), String(SEASON - 1));
    assert.equal(page.hash().get("date"), null);
    assert.equal(page.$("#boxscore").textContent.trim(), "");
    assert.match(page.$("#calendarHint").textContent, /No completed games/);
  });

  it("raises no errors", () => {
    assert.deepEqual(page.errors, []);
  });
});
