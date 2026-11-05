// The play-by-play beside the court, and its links to the shots on it.
import { escapeHtml } from "../lib/format.js";
import { loadPref, savePref } from "../lib/prefs.js";
import { boxscoreEl } from "./dom.js";
import { inSelectedPeriod } from "./filters.js";
import { playByPlay, shotData } from "./games.js";
import { pausePlayback, playback, seekToPlay, seekToShot } from "./playback.js";
import { state } from "./state.js";
import { teamColor } from "./trend.js";

// Sets --team on a play-by-play row so its hover tint is the team's primary color.
function teamRowStyle(tricode) {
  const { away, home } = state.currentGame;
  const color = [away, home].find((t) => t.abbreviation === tricode)?.colors?.primary;
  if (!color) {
    return "";
  }
  return ` style="--team: ${escapeHtml(teamColor(color))}"`;
}

export function renderPlayByPlay() {
  if (playByPlay.length === 0) {
    return '<p class="hint">No play-by-play for this game.</p>';
  }
  const plays = playByPlay.filter(inSelectedPeriod);
  if (plays.length === 0) {
    return '<p class="hint">No plays in this quarter.</p>';
  }

  const { away, home } = state.currentGame;
  let lastPeriod = null;
  const rows = plays.map((p) => {
    // When showing every quarter, label where each one starts.
    let divider = "";
    if (state.selectedPeriod === "all" && p.period !== lastPeriod) {
      divider = `<tr class="period-divider"><th colspan="4">${escapeHtml(p.period_label)}</th></tr>`;
    }
    lastPeriod = p.period;
    return `${divider}
    <tr data-play="${p.id}" class="${p.scored ? "scored" : ""}${isMadeFreeThrow(p) ? " free-throw-made" : ""}"${teamRowStyle(p.team)}>
      <td>${escapeHtml(p.clock)}</td>
      <td class="team">${escapeHtml(p.team ?? "")}</td>
      <td class="play">${escapeHtml(p.description)}</td>
      <td>${p.score.away}–${p.score.home}</td>
    </tr>`;
  }).join("");

  return `
    <div class="table-wrap">
      <table class="pbp">
        <thead>
          <tr><th>Time</th><th>Team</th><th>Play</th><th>${escapeHtml(away.abbreviation)}–${escapeHtml(home.abbreviation)}</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// The play-by-play sits beside the court and can be folded away to give the
// court the whole width. The choice is remembered.
export let pbpCollapsed = loadPref("pbpCollapsed", false) === true;

export function togglePbp(event) {
  const button = event.target.closest("#pbpToggle");
  if (!button) {
    return;
  }

  pbpCollapsed = !pbpCollapsed;
  savePref("pbpCollapsed", pbpCollapsed);
  track("pbp_toggle", { open: !pbpCollapsed });
  document.getElementById("shotLayout").classList.toggle("pbp-collapsed", pbpCollapsed);
  document.getElementById("playbyplay").hidden = pbpCollapsed;
  button.setAttribute("aria-expanded", String(!pbpCollapsed));
  if (pbpCollapsed) {
    button.title = "Show the play-by-play";
  } else {
    button.title = "Hide the play-by-play";
  }
}

// Scrolls the play-by-play (not the page) to a play and marks it as the
// current one, as playback takes each shot or a shot is clicked.
export function followPlay(playId) {
  const scroller = document.getElementById("playbyplay");
  if (!scroller || pbpCollapsed || playId == null) {
    return;
  }

  for (const el of scroller.querySelectorAll("tr.current")) {
    el.classList.remove("current");
  }
  const row = scroller.querySelector(`tr[data-play="${playId}"]`);
  if (!row) {
    return;
  }

  row.classList.add("current");
  const rowBox = row.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  const top = scroller.scrollTop + rowBox.top - box.top - (scroller.clientHeight - rowBox.height) / 2;
  scroller.scrollTo({ top, behavior: "smooth" });
}

// Shots on the court and their plays in the play-by-play are linked:
// hovering either highlights the other, and clicking a play that was a shot
// or a made free throw jumps the court to that moment in the game (see
// seekToShot and seekToPlay).

function shotMarksForPlay(playId) {
  return document.querySelectorAll(`#shotcharts .shot[data-play="${playId}"]`);
}

export function clearPlayLinks() {
  for (const el of boxscoreEl.querySelectorAll(".linked")) {
    el.classList.remove("linked");
  }
}

export function linkPlay(event) {
  clearPlayLinks();
  const row = event.target.closest?.("#playbyplay tr[data-play]");
  if (row) {
    const marks = shotMarksForPlay(row.dataset.play);
    for (const mark of marks) {
      mark.classList.add("linked");
    }
    // Only plays with a shot on the court can be clicked.
    row.classList.toggle("has-shot", marks.length > 0);
    return;
  }

  const mark = event.target.closest?.("#shotcharts .shot[data-play]");
  if (mark) {
    document.querySelector(`#playbyplay tr[data-play="${mark.dataset.play}"]`)?.classList.add("linked");
  }
}

// How long to wait for a smooth scroll to the court before jumping, when
// the browser doesn't say it's done (no scrollend event).
const SCROLL_SETTLE_MS = 600;

// A made free throw: worth jumping to, though it isn't on the shot chart.
function isMadeFreeThrow(play) {
  return play.scored && /free throw/i.test(play.description);
}

export function showPlayShot(event) {
  const row = event.target.closest("#playbyplay tr[data-play]");
  if (row) {
    jumpToPlay(row.dataset.play, "play_by_play");
  }
}

// Puts the court at a play (see seekToShot and seekToPlay): a shot, flying in
// with the court as it stood, or a made free throw. Pauses any playback, and
// brings the court into view first when it's off screen. Other plays aren't
// on the court and do nothing.
export function jumpToPlay(playId, source) {
  const mark = shotMarksForPlay(playId)[0];
  const play = playByPlay?.find((p) => String(p.id) === String(playId));
  const freeThrow = !mark && play && isMadeFreeThrow(play) && shotData;
  if (!mark && !freeThrow) {
    return;
  }

  // Clicking a play during playback pauses it there.
  if (playback?.frame) {
    track("playback", { action: "pause", playhead: playback.playhead, source: "play" });
    pausePlayback();
  }
  track("play_seek", { play_id: Number(playId), kind: freeThrow ? "free_throw" : "shot", source });
  followPlay(playId);
  document.getElementById("shotchartsSection").open = true;
  let seek = () => seekToShot(mark);
  if (freeThrow) {
    seek = () => seekToPlay(play);
  } else {
    for (const el of boxscoreEl.querySelectorAll(".picked")) {
      el.classList.remove("picked");
    }
    mark.classList.add("picked");
  }

  const chart = document.querySelector("#shotcharts .shotchart");
  const court = chart.getBoundingClientRect();
  if (court.top >= 0 && court.bottom <= window.innerHeight) {
    seek();
    return;
  }

  chart.scrollIntoView({ behavior: "smooth", block: "center" });
  let replayed = false;
  const replay = () => {
    if (!replayed) {
      replayed = true;
      seek();
    }
  };
  window.addEventListener("scrollend", replay, { once: true });
  setTimeout(replay, SCROLL_SETTLE_MS);
}
