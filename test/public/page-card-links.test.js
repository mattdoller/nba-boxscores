// Cards in the URL: a link can open a player's or team's card over its
// game, opening one from the page adds it to the history so Back closes it,
// and a return visit comes back to the game without the card.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { gameHash, openPage } from "./page.js";

describe("cards in the URL", () => {
  let page;
  let game;
  let player;
  let home;

  before(async () => {
    page = await openPage({
      hash: (fake) => {
        game = [...fake.byGame.entries()].map(([id, g]) => ({ id, ...g }))[0];
        const box = fake.byGame.get(game.id).boxscoretraditionalv3.boxScoreTraditional;
        // A link to the home team's card over the game.
        home = box.homeTeam.teamId;
        player = box.homeTeam.players[0].personId;
        return `${gameHash(game)}&card=team:${home}`;
      },
    });
    await page.waitFor(() => page.$(".team-game-log"), "the team card from the link");
    await page.settle();
  });

  after(() => page.close());

  const playerDialog = () => page.$("#playerDialog");
  const teamDialog = () => page.$("#teamDialog");
  const back = async () => {
    page.window.history.back();
    await page.waitFor(() => !page.hash().has("card") || page.hash().get("card") !== page.cardBefore, "Back");
    await page.settle();
  };
  const boxScoreRequests = () => page.requests.filter((r) => r.startsWith("/api/boxscore")).length;

  it("opens the card a link names, over its game", () => {
    assert.equal(teamDialog().open, true);
    assert.equal(page.$("#teamDialogTitle").textContent, page.$$(".scoreboard .team-link")[1].textContent);
    assert.equal(page.hash().get("card"), `team:${home}`);
  });

  it("drops the card from the URL when closed, without going back", () => {
    const length = page.window.history.length;
    page.click("#teamDialog .player-card-close");

    assert.equal(teamDialog().open, false);
    assert.equal(page.hash().get("card"), null);
    assert.equal(page.hash().get("date"), game.date);
    assert.equal(page.window.history.length, length);
  });

  it("adds a card opened from the page to the history", async () => {
    const length = page.window.history.length;
    page.click(`.player-link[data-player="${player}"]`);
    await page.waitFor(() => page.hash().get("zones"), "the card's zones");

    assert.equal(playerDialog().open, true);
    assert.equal(page.hash().get("card"), `player:${player}`);
    assert.equal(page.window.history.length, length + 1);
  });

  it("closes the card on Back, leaving the game as it was", async () => {
    const requests = boxScoreRequests();
    page.cardBefore = page.hash().get("card");
    await back();

    assert.equal(playerDialog().open, false);
    assert.equal(page.hash().get("card"), null);
    assert.equal(page.hash().get("date"), game.date);
    assert.equal(boxScoreRequests(), requests, "the game wasn't loaded again");
  });

  it("goes back past the card when it's closed from the page", async () => {
    page.click(page.$$(".scoreboard .team-link")[1]);
    await page.waitFor(() => page.$(".team-game-log"), "the team card");
    assert.equal(page.hash().get("card"), `team:${home}`);

    page.cardBefore = page.hash().get("card");
    page.click("#teamDialog .player-card-close");
    await page.waitFor(() => !page.hash().has("card"), "the card to leave the URL");

    assert.equal(teamDialog().open, false);
    assert.equal(page.window.history.state, null, "back on the game's own entry");
  });

  it("follows a link to a player's card with a season of zones", async () => {
    const career = await page.api(`/api/player?player_id=${player}`);
    const first = career.seasons[0].season;
    page.window.location.hash = `${gameHash(game).slice(1)}&card=player:${player}&zones=${first}`;
    await page.waitFor(() => playerDialog().open && Number(page.$("#cardZoneSeason")?.value) === first, "the card on that season");
    await page.settle();

    assert.equal(page.hash().get("zones"), String(first));
  });

  it("keeps the zone season in the URL as it changes", async () => {
    const latest = (await page.api(`/api/player?player_id=${player}`)).seasons.at(-1).season;
    page.change("#cardZoneSeason", String(latest));

    assert.equal(page.hash().get("zones"), String(latest));
    await page.settle();
  });

  it("drops a card that can't be opened, like a player not in the game", async () => {
    page.window.location.hash = `${gameHash(game).slice(1)}&card=player:12345`;
    await page.waitFor(() => !page.hash().has("card"), "the card to be dropped");

    assert.equal(playerDialog().open, false);
    assert.equal(page.hash().get("date"), game.date);
  });

  it("leaves the card out of the view a return visit opens", async () => {
    page.click(page.$$(".scoreboard .team-link")[0]);
    await page.waitFor(() => page.hash().has("card"), "the card");

    assert.equal(new URLSearchParams(page.pref("lastView")).get("card"), null);
    assert.equal(new URLSearchParams(page.pref("lastView")).get("date"), game.date);
  });

  it("opens a game from the team card in place of the card", async () => {
    await page.waitFor(() => page.$(".team-game-log"), "the team card");
    const row = page.$$(".team-game-log tbody tr").find((r) => !r.classList.contains("current"));
    page.click(row.cells[0]);

    assert.equal(teamDialog().open, false);
    await page.waitFor(() => page.hash().get("date") === row.dataset.date && page.$(".scoreboard"), "the game");
    await page.settle();
    assert.equal(page.hash().get("card"), null);
    assert.equal(page.window.history.state, null, "it replaced the card's history entry");
  });

  it("raises no errors", () => {
    assert.deepEqual(page.errors, []);
  });
});
