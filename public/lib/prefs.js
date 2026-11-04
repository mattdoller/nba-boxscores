// Remembers the page's settings between visits in localStorage, each as JSON
// under its own name. Storage can be unavailable (private windows, blocked
// site data); then reads fall back to the default and settings last only
// for the visit.
//
// The theme and the collapsed control panel are stored separately, as plain
// strings, since index.html reads them before the first paint.

export function loadPref(name, fallback) {
  try {
    const raw = localStorage.getItem(name);
    if (raw === null) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function savePref(name, value) {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch {
    // No storage: the setting holds for this visit only.
  }
}
