// User activity events. Every tracked action is logged to the console and
// dispatched on window as an "nba:track" CustomEvent, so monitoring or
// analytics can be attached without touching the app code:
//
//   window.addEventListener("nba:track", (event) => {
//     const { name, data, at, url } = event.detail;
//     navigator.sendBeacon("/collect", JSON.stringify(event.detail));
//   });
//
// app.js calls track() for actions with meaning (picking a team, sorting,
// playing). On top of those, every click is reported as a raw "click" event
// describing what was clicked.

const TRACK_EVENT = "nba:track";

let sessionId = null;
try {
  sessionId = sessionStorage.getItem("nbaSessionId");
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem("nbaSessionId", sessionId);
  }
} catch {
  sessionId = crypto.randomUUID();
}

function track(name, data = {}) {
  const detail = {
    name,
    data,
    at: new Date().toISOString(),
    url: location.href,
    session: sessionId,
  };
  console.info(`[track] ${name}`, data);
  window.dispatchEvent(new CustomEvent(TRACK_EVENT, { detail }));
}

const CLICKABLE = "button, a, summary, input, select, label, [role=button], .shot, .flatpickr-day";

// A short, stable description of a clicked element for the raw click event.
function describeTarget(target) {
  const el = target.closest?.(CLICKABLE) ?? target;
  const text = (el.getAttribute?.("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
  const description = {
    tag: el.tagName?.toLowerCase(),
    id: el.id,
    classes: [...(el.classList ?? [])].join(" "),
    text: text.slice(0, 80),
    value: el.value,
    section: el.parentElement?.closest("[id]")?.id,
  };
  if (el.dataset && Object.keys(el.dataset).length > 0) {
    description.data = { ...el.dataset };
  }
  // Leave out empty fields so the console stays readable.
  return Object.fromEntries(Object.entries(description).filter(([, value]) => value !== undefined && value !== ""));
}

// Capture phase, so clicks are seen even when a handler stops propagation.
document.addEventListener("click", (event) => {
  track("click", {
    ...describeTarget(event.target),
    x: event.clientX,
    y: event.clientY,
    keyboard: event.detail === 0,
  });
}, { capture: true });

// Initial load, reload, or back/forward, with timings from the Navigation Timing API.
window.addEventListener("load", () => {
  const nav = performance.getEntriesByType("navigation")[0];
  track("page_load", {
    type: nav?.type,
    referrer: document.referrer || undefined,
    hash: location.hash || undefined,
    domContentLoadedMs: nav && Math.round(nav.domContentLoadedEventEnd),
    loadMs: nav && Math.round(nav.loadEventStart),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  });
});

window.addEventListener("pagehide", () => {
  track("page_hide", { sinceLoadMs: Math.round(performance.now()) });
});
