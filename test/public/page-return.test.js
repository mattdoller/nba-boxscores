// Coming back without a link: the page opens where the last visit left off.
// app.js reads the saved view when it loads, so this is its own page.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SEASON, openPage } from "./page.js";

describe("coming back to the page", () => {
  let page;
  let game;

  before(async () => {
    page = await openPage({
      storage: (fake) => {
        game = [...fake.byGame.values()][1];
        return { lastView: `team=${game.home}&season=${SEASON}&date=${game.date}&q=Q3` };
      },
    });
    await page.waitFor(() => page.$(".shotchart .shot"), "the game");
    await page.settle();
  });

  after(() => page.close());

  it("opens the game and quarter the last visit left off on", () => {
    assert.equal(page.hash().get("date"), game.date);
    assert.equal(page.hash().get("team"), game.home);
    assert.equal(page.$('#periodTabs button[aria-pressed="true"]').dataset.period, "3");
  });

  it("raises no errors", () => {
    assert.deepEqual(page.errors, []);
  });
});
