// Sortable tables on the player and team cards. A table opts in with
// data-sort-table (its name, for remembering the sort) and sort buttons in
// its header (see sortHeader). Clicking a header sorts by that column, and
// again reverses it. The sort is remembered per table and kept as the card
// redraws. Rows sort by each cell's data-value when it has one, otherwise
// by its text, as a number when it reads as one. Empty cells ("–") always
// go last.
import { escapeHtml } from "../lib/format.js";
import { loadPref, savePref } from "../lib/prefs.js";

// { [table name]: { col, dir } }
const sorts = loadPref("cardSorts", {});

// A header cell with a sort button. `text` columns read left to right and
// start A–Z; `ascending` ones start low to high (like ranks, where 1st is
// best). Other columns start high to low.
export function sortHeader(label, { title = "", text = false, ascending = false } = {}) {
  let first = "desc";
  if (text || ascending) {
    first = "asc";
  }
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<th class="${text ? "text" : ""}" aria-sort="none"${titleAttr}><button type="button" class="sort" data-first="${first}">${label}</button></th>`;
}

// What a cell sorts by: a number when it reads as one ("1,234", "+4.2",
// "49.3", "2023–24", "5th"), its text otherwise, null when empty.
function sortValue(cell) {
  const raw = (cell?.dataset.value ?? cell?.textContent ?? "").trim();
  if (raw === "" || raw === "–") {
    return null;
  }
  const number = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isNaN(number)) {
    return number;
  }
  return raw.toLowerCase();
}

function sortRows(table, col, dir) {
  const body = table.tBodies[0];
  const rows = [...body.rows];
  rows.forEach((row, i) => {
    row.dataset.order ??= String(i);
  });
  const sign = dir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const x = sortValue(a.cells[col]);
    const y = sortValue(b.cells[col]);
    if (x === null || y === null) {
      if (x === y) {
        return Number(a.dataset.order) - Number(b.dataset.order);
      }
      return x === null ? 1 : -1;
    }
    let order;
    if (typeof x === "number" && typeof y === "number") {
      order = x - y;
    } else {
      order = String(x).localeCompare(String(y));
    }
    return sign * order || Number(a.dataset.order) - Number(b.dataset.order);
  });
  body.append(...rows);
  for (const th of table.tHead.rows[0].cells) {
    let ariaSort = "none";
    if (th.cellIndex === col) {
      ariaSort = dir === "asc" ? "ascending" : "descending";
    }
    th.setAttribute("aria-sort", ariaSort);
  }
}

// Puts each sortable table in a card in its remembered order. Called after
// the card draws.
export function applyCardSorts(root) {
  for (const table of root.querySelectorAll("table[data-sort-table]")) {
    const sort = sorts[table.dataset.sortTable];
    if (sort && sort.col < table.tHead.rows[0].cells.length) {
      sortRows(table, sort.col, sort.dir);
    }
  }
}

// Handles a click on a sortable card table's header. Returns true when it
// was one.
export function cardSortClick(event) {
  const button = event.target.closest("table[data-sort-table] thead .sort");
  if (!button) {
    return false;
  }

  const table = button.closest("table");
  const name = table.dataset.sortTable;
  const col = button.closest("th").cellIndex;
  let dir = button.dataset.first;
  if (sorts[name]?.col === col) {
    dir = sorts[name].dir === "asc" ? "desc" : "asc";
  }
  sorts[name] = { col, dir };
  savePref("cardSorts", sorts);
  track("card_table_sort", { table: name, column: button.textContent.trim(), dir });
  sortRows(table, col, dir);
  button.focus();
  return true;
}
