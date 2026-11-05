// The game's biggest plays: the baskets that moved the scoring team's chance
// of winning the most (see biggestPlays in winprob.js), each a click from
// its moment on the court.
import { escapeHtml } from "../lib/format.js";
import { pctLabel, sideWinProb } from "../lib/winprob.js";
import { jumpToPlay } from "./pbp.js";
import { state } from "./state.js";
import { biggestPlays } from "./winprob.js";

const PLAYS_SHOWN = 8;

export function renderBigPlays() {
  const plays = biggestPlays(PLAYS_SHOWN).filter((entry) => entry.gain > 0);
  if (plays.length === 0) {
    return '<p class="hint">No scoring plays in this game\'s play-by-play.</p>';
  }

  const { away, home } = state.currentGame;
  const rows = plays.map((entry, i) => {
    const { play, side } = entry;
    const team = state.currentGame[side];
    const before = pctLabel(sideWinProb(entry.wpBefore, side));
    const after = pctLabel(sideWinProb(entry.wpAfter, side));
    return `
      <tr data-play="${play.id}" title="Show it on the court">
        <td>${i + 1}</td>
        <td class="text">${escapeHtml(play.period_label)} · ${escapeHtml(play.clock)}</td>
        <td class="text">${escapeHtml(team.abbreviation)}</td>
        <td class="text play">${escapeHtml(play.description)}</td>
        <td>${play.score.away}–${play.score.home}</td>
        <td>${before} → ${after}</td>
        <td class="hot">+${Math.round(entry.gain * 100)}</td>
      </tr>`;
  }).join("");
  return `
    <div class="table-wrap">
      <table class="stats big-plays">
        <thead>
          <tr><th><span class="visually-hidden">Rank</span></th><th class="text">Time</th><th class="text">Team</th><th class="text">Play</th>
            <th>${escapeHtml(away.abbreviation)}–${escapeHtml(home.abbreviation)}</th>
            <th title="The scoring team's chance of winning, just before and after">To win</th><th title="Points of win probability gained">Swing</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="hint">By win probability, from the score, time left, and who has the ball (see the scoring runs' win probability line). Click a play to see it on the court.</p>`;
}

export function showBigPlay(event) {
  const row = event.target.closest(".big-plays tr[data-play]");
  if (row) {
    jumpToPlay(row.dataset.play, "biggest_plays");
  }
}
