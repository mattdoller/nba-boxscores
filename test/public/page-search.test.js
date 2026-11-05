// Finding a player by name from the control panel, and opening the card of
// someone who isn't in the game on screen, by search or by link.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { gameHash, openPage } from "./page.js";

describe("finding a player", () => {
  let page;
  let game;
  let elsewhere;

  before(async () => {
    page = await openPage({
      hash: (fake) => {
        game = [...fake.byGame.values()][0];
        return gameHash(game);
      },
    });
    await page.waitFor(() => page.$(".player-link"), "the box score");
    await page.settle();
    // A player on a team that isn't in the game on screen.
    const players = await page.api("/api/players");
    elsewhere = players.find((p) => p.team && p.team !== game.home && p.team !== game.away);
  });

  after(() => page.close());

  const search = () => page.$("#playerSearch");
  const results = () => page.$$("#playerResults li[data-player]");
  const type = async (text) => {
    search().value = text;
    search().dispatchEvent(new page.window.Event("input", { bubbles: true }));
    await page.waitFor(() => !page.$("#playerResults").hidden, "the results");
    await page.settle();
  };

  it("lists players whose names start with what's typed", async () => {
    const [first, last] = elsewhere.name.split(" ");
    await type(`${first.slice(0, 3)} ${last.slice(0, 3)}`);

    const names = results().map((li) => li.querySelector(".result-name").textContent);
    assert.ok(names.includes(elsewhere.name), names.join(", "));
    assert.ok(names.length <= 8);
    assert.equal(search().getAttribute("aria-expanded"), "true");
  });

  it("says when no one matches", async () => {
    await type("zzzz");

    assert.equal(results().length, 0);
    assert.match(page.$("#playerResults").textContent, /No players/);
  });

  it("moves through the matches with the arrow keys, and closes with Escape", async () => {
    await type(elsewhere.name.split(" ")[1].slice(0, 1));
    assert.ok(results().length > 1);
    assert.equal(results()[0].getAttribute("aria-selected"), "true");

    page.key("ArrowDown", search());
    assert.equal(results()[1].getAttribute("aria-selected"), "true");
    assert.equal(search().getAttribute("aria-activedescendant"), "playerResult1");

    page.key("Escape", search());
    assert.equal(page.$("#playerResults").hidden, true);
    assert.equal(search().value, "");
  });

  it("opens the card of the player picked, even one who isn't in the game", async () => {
    await type(elsewhere.name);
    const length = page.window.history.length;
    page.key("Enter", search());

    assert.equal(page.$("#playerDialog").open, true);
    assert.equal(page.$("#playerDialogTitle").textContent, elsewhere.name);
    assert.match(page.$(".player-card-about").textContent, new RegExp(`${elsewhere.from}`));
    assert.equal(page.hash().get("card"), `player:${elsewhere.id}`);
    assert.equal(page.window.history.length, length + 1, "Back closes it");
    assert.equal(search().value, "");
    await page.waitFor(() => page.$$("#playerDialog .career tbody tr[data-season]").length > 0, "their career");
    await page.settle();
  });

  it("opens that card from a link, too", async () => {
    page.click("#playerDialog .player-card-close");
    await page.waitFor(() => !page.hash().has("card"), "the card to close");
    await page.settle();

    page.window.location.hash = `${gameHash(game).slice(1)}&card=player:${elsewhere.id}`;
    await page.waitFor(() => page.$("#playerDialog").open, "the card from the link");
    assert.equal(page.$("#playerDialogTitle").textContent, elsewhere.name);
    await page.settle();
  });

  it("raises no errors", () => {
    assert.deepEqual(page.errors, []);
  });
});
