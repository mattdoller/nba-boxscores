// One tooltip shared by the shot charts, zones, and scoring trend.

// One tooltip shared by the shot charts and the scoring trend.
const tooltip = document.createElement("div");
tooltip.className = "tooltip";
tooltip.hidden = true;
document.body.append(tooltip);

// Shows the tooltip above and to the right of (x, y), flipping inward near the viewport edges.
export function showTooltip(html, x, y) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const { offsetWidth: w, offsetHeight: h } = tooltip;
  let left = x + 12;
  if (left + w > window.innerWidth - 8) {
    left = x - w - 12;
  }
  let top = y - h - 12;
  if (top < 8) {
    top = y + 12;
  }
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

export function hideTooltip() {
  tooltip.hidden = true;
}
