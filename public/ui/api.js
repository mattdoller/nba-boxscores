// Requests to the app's own API, the loading indicator they drive, and the
// status line that reports what went wrong.
import { statusEl } from "./dom.js";

// Every API call goes through getJson, so counting the calls in flight here
// drives one loading indicator for all of them.
const apiActivity = document.getElementById("apiActivity");
const apiActivityLabel = apiActivity.querySelector(".api-activity-label");
let requestsInFlight = 0;

function trackRequests(change) {
  requestsInFlight += change;
  const active = requestsInFlight > 0;
  apiActivity.classList.toggle("active", active);
  // The label only has text while active, so screen readers announce it once
  // per burst of requests rather than reading a hidden "Loading…".
  apiActivityLabel.textContent = "";
  if (active) {
    apiActivityLabel.textContent = "Loading…";
  }
}

export async function getJson(url) {
  trackRequests(1);
  try {
    const res = await fetch(url);
    // A stale server without this route answers with Express's HTML 404 page.
    if (!res.headers.get("content-type")?.includes("application/json")) {
      throw new Error(`Request failed (${res.status}). If the server was started before a code change, restart it.`);
    }
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return body;
  } finally {
    trackRequests(-1);
  }
}

export function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}
