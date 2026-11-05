// Loads the real page into jsdom for the front-end tests: public/index.html,
// with public/app.js and its modules imported as the browser would, talking
// to the real server. stats.nba.com is stubbed with a small fake season from
// dev/fake-season.js, the same made-up games bin/load-fixtures caches.
//
// jsdom can't run ES modules, so the page's globals (document, window,
// location, ...) are put on Node's global object and app.js is imported
// here. Modules load once per process, so each test file opens one page and
// its tests walk through it in order.
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { fakeSeason } from "../../dev/fake-season.js";
import { markFixtures } from "../../nba-api/cache.js";
import { SeasonType, getTeams, seasonString, teamGameLog } from "../../nba-api/index.js";

export const SEASON = 2025;

const HTML = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8")
  // The page's scripts are loaded by openPage instead.
  .replace(/<script[\s\S]*?<\/script>/g, "");

// Answers stats.nba.com requests from the fake season, like bin/load-fixtures.
function statsApi(fake, url) {
  const endpoint = url.pathname.split("/").pop();
  const params = url.searchParams;
  let body;
  if (endpoint === "teamgamelog") {
    body = { resultSets: [{ name: "TeamGameLog", headers: [], rowSet: [] }] };
    // The fake season's regular season; any other season or season type
    // has no games.
    if (params.get("SeasonType") === SeasonType.regular && params.get("Season") === seasonString(SEASON)) {
      body = fake.teamgamelog.get(Number(params.get("TeamID")));
    }
  } else if (endpoint === "teamyearbyyearstats") {
    body = fake.teamHistories.get(Number(params.get("TeamID")));
  } else if (endpoint === "leaguegamelog") {
    body = fake.leagueGameLog.get(Number(params.get("Season").slice(0, 4)));
  } else if (endpoint === "leaguedashteamstats") {
    body = fake.league.get(Number(params.get("Season").slice(0, 4)));
  } else if (endpoint === "playercareerstats") {
    body = fake.players.get(Number(params.get("PlayerID")))?.career;
  } else if (endpoint === "shotchartdetail" && params.get("PlayerID") !== "0") {
    body = fake.players.get(Number(params.get("PlayerID")))?.shotCharts.get(Number(params.get("Season").slice(0, 4)));
  } else if (endpoint === "shotchartdetail" && !params.get("GameID")) {
    body = fake.teamShotCharts.get(Number(params.get("TeamID")));
  } else {
    body = fake.byGame.get(params.get("GameID"))?.[endpoint];
  }
  if (!body) {
    return new Response("Not a fake request", { status: 404 });
  }
  return Response.json(body);
}

// A stand-in for flatpickr, which the page loads from a CDN: just what the
// page calls, with pick() to choose a date the way a click on the calendar
// does.
function fakeFlatpickr(window) {
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  const flatpickr = (selector, config) => {
    const monthNav = window.document.createElement("div");
    monthNav.innerHTML = '<span class="flatpickr-current-month"></span>';
    window.document.querySelector(selector).append(monthNav);
    const instance = {
      config: { ...config },
      selectedDates: [],
      currentMonth: 0,
      currentYear: 2000,
      monthNav,
      l10n: { months: { longhand: MONTHS } },
      set(key, value) {
        this.config[key] = value;
      },
      clear() {
        this.selectedDates = [];
      },
      jumpToDate(date) {
        const day = new Date(`${date}T12:00`);
        this.currentMonth = day.getMonth();
        this.currentYear = day.getFullYear();
      },
      setDate(date, triggerChange) {
        this.selectedDates = [new Date(`${date}T12:00`)];
        if (triggerChange) {
          config.onChange?.(this.selectedDates);
        }
      },
      pick(date) {
        if (!this.config.enable.includes(date)) {
          throw new Error(`${date} isn't enabled on the calendar`);
        }
        this.setDate(date, true);
      },
    };
    config.onReady?.(instance.selectedDates, "", instance);
    flatpickr.instance = instance;
    return instance;
  };
  flatpickr.formatDate = (date) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  return flatpickr;
}

// Browser features jsdom doesn't have. Animations finish at once, and the
// page is told the user prefers reduced motion so shots skip their flights.
function fillGaps(window) {
  window.matchMedia = (query) => ({
    matches: query.includes("prefers-reduced-motion"),
    addEventListener() {},
    removeEventListener() {},
  });
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.Element.prototype.animate = function () {
    return { finished: Promise.resolve({ effect: { target: this } }), cancel() {} };
  };
  // <dialog> without the modal parts: opening sets `open`, closing clears it
  // and fires close, as a browser does.
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    if (this.open) {
      this.open = false;
      this.dispatchEvent(new window.Event("close"));
    }
  };
  window.Element.prototype.scrollIntoView = () => {};
  window.Element.prototype.scrollTo = () => {};
  window.Element.prototype.setPointerCapture = () => {};
  window.scrollTo = () => {};
  // No layout either: every element is as wide as a desktop chart area, so
  // charts that size themselves to their box draw.
  for (const prop of ["clientWidth", "offsetWidth"]) {
    Object.defineProperty(window.HTMLElement.prototype, prop, { get: () => 960, configurable: true });
  }
  window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 100 });
  window.SVGElement.prototype.getScreenCTM = () => ({ a: 1 });
}

const GLOBALS = [
  "window", "document", "location", "history", "localStorage", "sessionStorage",
  "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "matchMedia",
  "ResizeObserver", "flatpickr", "track",
];

// The hash that opens a fake game, by default the season's first.
export function gameHash(game) {
  return `#team=${game.home}&season=${SEASON}&date=${game.date}`;
}

// Opens the page and resolves once it has loaded and settled. `hash` is the
// URL's hash, or a function of the fake season that returns one, e.g.
// (fake) => gameHash(...). `storage` presets localStorage, like a returning
// visitor's saved settings; it can be a function of the fake season too. `fixtures` caches the season's game logs and
// marks the cache as test data, as bin/load-fixtures does.
export async function openPage({ hash = "", storage = {}, gamesPerTeam = 2, fixtures = false } = {}) {
  const fake = fakeSeason({ season: SEASON, gamesPerTeam, seed: 1 });
  if (typeof hash === "function") {
    hash = hash(fake);
  }
  if (typeof storage === "function") {
    storage = storage(fake);
  }
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (err) => errors.push(err.message));
  const dom = new JSDOM(HTML, { url: `http://localhost/${hash}`, pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  window.addEventListener("error", (event) => errors.push(event.message));
  for (const [key, value] of Object.entries(storage)) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }
  fillGaps(window);
  window.flatpickr = fakeFlatpickr(window);
  const tracked = [];
  window.track = (name, data = {}) => tracked.push({ name, data });
  for (const name of GLOBALS) {
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true });
  }

  // The server runs in this process. Its requests to stats.nba.com get the
  // fake season; the page's requests to /api go to the server.
  const { app } = await import("../../server.js");
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = (input, init) => {
    const url = new URL(input, window.location.href);
    if (url.hostname === "stats.nba.com") {
      return Promise.resolve(statsApi(fake, url));
    }
    requests.push(`${url.pathname}${url.search}`);
    return realFetch(`${base}${url.pathname}${url.search}`, init);
  };

  if (fixtures) {
    for (const team of getTeams()) {
      await teamGameLog({ teamId: team.id, season: SEASON, seasonType: SeasonType.regular });
    }
    markFixtures();
  }

  await import("../../public/app.js");

  const page = {
    window,
    document: window.document,
    fake,
    tracked,
    requests,
    errors,
    calendar: () => window.flatpickr.instance,
    $: (selector) => window.document.querySelector(selector),
    $$: (selector) => [...window.document.querySelectorAll(selector)],
    // Waits for a condition the page reaches on its own, like a render after
    // a request.
    async waitFor(check, what = "the page", timeoutMs = 5_000) {
      const start = Date.now();
      for (;;) {
        const result = check();
        if (result) {
          return result;
        }
        if (Date.now() - start > timeoutMs) {
          throw new Error(`Timed out waiting for ${what}`);
        }
        await sleep(10);
      }
    },
    // Waits until the page has no requests in flight and nothing left to
    // render from them.
    async settle() {
      await page.waitFor(() => !page.$("#apiActivity").classList.contains("active"), "requests to finish");
      await sleep(20);
    },
    click(target) {
      const el = typeof target === "string" ? page.$(target) : target;
      if (!el) {
        throw new Error(`Nothing to click: ${target}`);
      }
      el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
      return el;
    },
    // Changes a form control the way a user does, firing change.
    change(target, value) {
      const el = typeof target === "string" ? page.$(target) : target;
      if (el.type === "checkbox") {
        el.checked = value;
      } else {
        el.value = value;
      }
      el.dispatchEvent(new window.Event("change", { bubbles: true }));
      return el;
    },
    key(key, target = window.document.body) {
      target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    },
    hover(target) {
      const el = typeof target === "string" ? page.$(target) : target;
      el.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
      el.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 10 }));
      return el;
    },
    // A response from the server's API, to check the page against, without
    // counting it among the page's requests.
    async api(path) {
      return (await realFetch(`${base}${path}`)).json();
    },
    hash: () => new URLSearchParams(window.location.hash.slice(1)),
    pref: (key) => JSON.parse(window.localStorage.getItem(key)),
    // The fake season's games, in order: { id, date, home, away, score }.
    games() {
      return [...fake.byGame].map(([id, game]) => ({ id, ...game }));
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      globalThis.fetch = realFetch;
      window.close();
    },
  };
  await page.waitFor(() => !page.$("#teamSelect").disabled, "the teams to load");
  await page.settle();
  return page;
}
