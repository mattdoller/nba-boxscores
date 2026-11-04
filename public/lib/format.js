// Formatting helpers shared across the page.

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function round1(n) {
  return Math.round(n * 10) / 10;
}

export function periodLabel(period) {
  if (period <= 4) {
    return `Q${period}`;
  }
  return `OT${period - 4}`;
}

// An NBA season is labeled by the year it starts; it tips off in October.
export function currentSeason() {
  const now = new Date();
  if (now.getMonth() >= 9) {
    return now.getFullYear();
  }
  return now.getFullYear() - 1;
}
