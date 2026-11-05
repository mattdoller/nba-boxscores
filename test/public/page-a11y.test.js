// Accessibility: axe-core checks the page as a user would meet it: a game,
// both cards, and the player search's results. jsdom has no layout, so the
// checks that need one (color contrast, mainly) are left to a browser.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { gameHash, openPage } from "./page.js";

// Rules jsdom can't judge without layout or rendering.
const NEEDS_LAYOUT = ["color-contrast", "target-size", "scrollable-region-focusable"];

describe("accessibility", () => {
  let page;
  let axe;

  before(async () => {
    page = await openPage({ hash: (fake) => gameHash(fake.byGame.values().next().value), indexed: true });
    await page.waitFor(() => page.$(".shotchart .shot") && page.$(".lineups-table") && page.$(".big-plays"), "the game");
    await page.settle();
    // axe-core reads the page's window and document from the globals the
    // harness sets.
    axe = (await import("axe-core")).default;
  });

  after(() => page.close());

  // The violations axe finds in part of the page, as readable lines.
  async function violations(context) {
    const results = await axe.run(context, {
      rules: Object.fromEntries(NEEDS_LAYOUT.map((rule) => [rule, { enabled: false }])),
    });
    return results.violations.flatMap((v) => v.nodes.map((node) => `${v.id}: ${v.help} (${node.target.join(" ")})`));
  }

  it("finds nothing on a game's page", async () => {
    assert.deepEqual(await violations(page.document), []);
  });

  it("finds nothing on a player card", async () => {
    page.click(page.$(".player-link"));
    await page.waitFor(() => page.$("#playerDialog .career tbody tr[data-season]") && page.$("#playerDialog .season-so-far .season-game-log"), "the card");
    await page.settle();

    assert.deepEqual(await violations(page.$("#playerDialog")), []);
    page.click("#playerDialog .player-card-close");
  });

  it("finds nothing on a team card", async () => {
    page.click(page.$(".team-link"));
    await page.waitFor(() => page.$(".team-game-log") && page.$(".team-history-table"), "the card");
    await page.settle();

    assert.deepEqual(await violations(page.$("#teamDialog")), []);
    page.click("#teamDialog .player-card-close");
  });

  it("finds nothing in the player search's results", async () => {
    const search = page.$("#playerSearch");
    search.value = "a";
    search.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    await page.waitFor(() => !page.$("#playerResults").hidden, "the results");

    assert.deepEqual(await violations(page.$(".player-search")), []);
  });
});
