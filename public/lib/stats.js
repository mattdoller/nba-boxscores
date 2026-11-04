// Box score rows: playing time and sorting.

export function minutes(row) {
  return parseInt(row.min, 10) || 0;
}

// "34:12" -> 2052, so minutes sort by the seconds too.
export function minuteSeconds(row) {
  const [m, s] = String(row.min ?? "").split(":").map(Number);
  return (m || 0) * 60 + (s || 0);
}

// Shooting columns sort by makes, then by fewer attempts (8-15 above 8-17).
export function sortValue(row, key) {
  if (key === "player") {
    return `${row.last_name} ${row.first_name}`.toLowerCase();
  }
  if (key === "min") {
    return minuteSeconds(row);
  }
  if (key === "fg" || key === "fg3" || key === "ft") {
    return (row[`${key}m`] ?? 0) * 1000 - (row[`${key}a`] ?? 0);
  }
  return row[key] ?? -Infinity;
}

// A team's players who played, sorted by `sort` ({ key, dir }). Ties fall
// back to minutes played, most first.
export function sortPlayers(rows, teamId, { key, dir }) {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .filter((r) => r.team_id === teamId && r.recorded && minutes(r) > 0)
    .sort((a, b) => {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      let order;
      if (typeof va === "string") {
        order = va.localeCompare(vb);
      } else {
        order = va - vb;
      }
      return sign * order || minuteSeconds(b) - minuteSeconds(a);
    });
}
