// Playing a game's shots back, and the play-by-play's links to the court:
// hovering a play marks its shot, and clicking one jumps the court there.
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, describe, it } from "node:test";
import { gameHash, openPage } from "./page.js";

describe("playback and the play-by-play", () => {
  let page;
  let plays;

  before(async () => {
    page = await openPage({ hash: (fake) => gameHash(fake.byGame.values().next().value) });
    const [game] = page.games();
    await page.waitFor(() => page.$(".shotchart .shot") && page.$(".pbp"), "the game to load");
    await page.settle();
    plays = await page.api(`/api/playbyplay?game_id=${game.id}`);
  });

  after(() => page.close());

  const marks = () => page.$$("#shotcharts .shot");
  const revealed = () => page.$$("#shotcharts .shot.revealed").length;
  const playLabel = () => page.$("#playButton").textContent.trim();
  // The marks in the order the shots were taken.
  const inOrder = () => marks().sort((a, b) => Number(a.dataset.t) - Number(b.dataset.t));

  it("highlights a play's shot on the court while the play is hovered", () => {
    const mark = marks().find((m) => m.dataset.play);
    const row = page.$(`#playbyplay tr[data-play="${mark.dataset.play}"]`);

    page.hover(row.querySelector(".play"));
    assert.ok(mark.classList.contains("linked"));

    page.$("#boxscore").dispatchEvent(new page.window.MouseEvent("mouseleave"));
    assert.ok(!mark.classList.contains("linked"));
  });

  it("plays the shots back from blank courts", async () => {
    page.click("#playButton");

    assert.match(playLabel(), /Pause/);
    assert.match(page.$("#playClock").textContent, /^Q1 · \d+:\d\d$/);
    await page.waitFor(() => revealed() > 0, "a shot to land");
    assert.ok(revealed() < marks().length, "the rest are still to come");
  });

  it("pauses, and the court holds still", async () => {
    page.click("#playButton");

    assert.match(playLabel(), /Play/);
    const held = revealed();
    const clock = page.$("#playClock").textContent;
    await sleep(150);
    assert.equal(revealed(), held);
    assert.equal(page.$("#playClock").textContent, clock);
  });

  it("resumes with the space bar, and pauses again", async () => {
    const held = revealed();
    page.key(" ");

    assert.match(playLabel(), /Pause/);
    await page.waitFor(() => revealed() > held, "playback to carry on");

    page.key(" ");
    assert.match(playLabel(), /Play/);
  });

  it("cycles the speed and remembers it", () => {
    const labels = [];
    for (let i = 0; i < 4; i++) {
      page.click("#speedButton");
      labels.push(page.$("#speedButton").textContent);
    }

    assert.deepEqual(labels, ["2×", "4×", "½×", "1×"]);
    assert.equal(page.pref("speed"), 1);
  });

  it("jumps the court to a shot clicked in the play-by-play", async () => {
    const shots = inOrder();
    const index = Math.floor(shots.length / 2);
    const mark = shots[index];
    const row = page.$(`#playbyplay tr[data-play="${mark.dataset.play}"]`);
    const play = plays.find((p) => String(p.id) === mark.dataset.play);

    page.click(row.querySelector(".play"));

    assert.match(playLabel(), /Play/, "stays paused");
    assert.equal(page.$("#playClock").textContent, `${play.period_label} · ${play.clock}`);
    await page.waitFor(() => mark.classList.contains("revealed"), "the clicked shot to land");
    // Every shot before it is on the court, and none after.
    assert.ok(shots.slice(0, index).every((m) => m.classList.contains("revealed")));
    assert.ok(shots.slice(index + 1).every((m) => !m.classList.contains("revealed") || m.dataset.t === mark.dataset.t));
    assert.ok(row.classList.contains("current"));
  });

  it("jumps the court to a made free throw clicked in the play-by-play", () => {
    const freeThrow = plays.find((p) => /Free Throw/.test(p.description) && !/MISS/.test(p.description) && p.period > 1);
    const row = page.$(`#playbyplay tr[data-play="${freeThrow.id}"]`);
    assert.ok(row.classList.contains("free-throw-made"));

    page.click(row.querySelector(".play"));

    assert.equal(page.$("#playClock").textContent, `${freeThrow.period_label} · ${freeThrow.clock}`);
    const t = Math.max(...page.$$("#shotcharts .shot.revealed").map((m) => Number(m.dataset.t)));
    const next = Math.min(...page.$$("#shotcharts .shot:not(.revealed)").map((m) => Number(m.dataset.t)));
    assert.ok(t <= next, "the court shows the shots up to the free throw and no later");
  });

  it("carries on from there when played", async () => {
    const held = revealed();
    page.click("#playButton");

    await page.waitFor(() => revealed() > held, "playback to carry on from the jump");
    page.click("#playButton");
  });

  it("steps through the quarters with the arrow keys", () => {
    page.key("ArrowRight");
    assert.equal(page.hash().get("q"), "Q1");
    page.key("ArrowRight");
    assert.equal(page.hash().get("q"), "Q2");
    page.key("ArrowLeft");
    page.key("ArrowLeft");
    assert.equal(page.hash().get("q"), null);
  });

  it("raises no errors", () => {
    assert.deepEqual(page.errors, []);
  });
});
