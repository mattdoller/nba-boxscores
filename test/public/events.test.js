import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";

const SOURCE = readFileSync(new URL("../../public/events.js", import.meta.url), "utf8");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Runs events.js in a fresh page and returns its window, with every tracked
// event collected in `window.tracked`. `beforeLoad` can set up the window
// first (e.g. its storage).
function loadEvents(body = "", beforeLoad = () => {}) {
  const { window } = new JSDOM(`<!DOCTYPE html><body>${body}</body>`, {
    url: "http://localhost/#team=BOS",
    runScripts: "outside-only",
  });
  window.console.info = () => {};
  // jsdom has no Navigation Timing; the page_load event reads it.
  window.performance.getEntriesByType = () => [];
  window.tracked = [];
  window.addEventListener("nba:track", (event) => window.tracked.push(event.detail));
  beforeLoad(window);
  window.eval(SOURCE);
  return window;
}

describe("track", () => {
  it("dispatches an nba:track event describing the action", () => {
    const window = loadEvents();

    window.track("period_select", { period: 2 });

    const [detail] = window.tracked;
    assert.equal(detail.name, "period_select");
    assert.deepEqual({ ...detail.data }, { period: 2 });
    assert.equal(detail.url, "http://localhost/#team=BOS");
    assert.match(detail.session, UUID);
    assert.ok(!Number.isNaN(Date.parse(detail.at)));
  });

  it("keeps the session id the tab already has", () => {
    const window = loadEvents("", (w) => w.sessionStorage.setItem("nbaSessionId", "earlier-session"));

    window.track("x");

    assert.equal(window.tracked[0].session, "earlier-session");
  });

  it("remembers a new session id for the tab", () => {
    const window = loadEvents();

    window.track("x");

    assert.equal(window.sessionStorage.getItem("nbaSessionId"), window.tracked[0].session);
  });

  it("still has a session id when storage is unavailable", () => {
    const window = loadEvents("", (w) => {
      Object.defineProperty(w, "sessionStorage", {
        get() {
          throw new Error("SecurityError");
        },
      });
    });

    window.track("x");

    assert.match(window.tracked[0].session, UUID);
  });
});

describe("describeTarget", () => {
  it("describes the clickable element around the target", () => {
    const window = loadEvents(`
      <section id="shotcharts">
        <button type="button" id="playButton" class="play-button" aria-label="Play shots" data-period="2">
          <span>▶</span> Play
        </button>
      </section>`);

    const description = window.describeTarget(window.document.querySelector("#playButton span"));

    assert.deepEqual(JSON.parse(JSON.stringify(description)), {
      tag: "button",
      id: "playButton",
      classes: "play-button",
      text: "Play shots",
      section: "shotcharts",
      data: { period: "2" },
    });
  });

  it("falls back to the element's text and leaves out empty fields", () => {
    const window = loadEvents("<a>  Box   score  </a>");

    const description = window.describeTarget(window.document.querySelector("a"));

    assert.deepEqual(JSON.parse(JSON.stringify(description)), { tag: "a", text: "Box score" });
  });
});

describe("click tracking", () => {
  it("reports every click as a raw click event", () => {
    const window = loadEvents('<button type="button" id="go">Go</button>');

    window.document.getElementById("go").click();

    const click = window.tracked.find((d) => d.name === "click");
    assert.equal(click.data.id, "go");
    assert.equal(click.data.text, "Go");
  });
});
