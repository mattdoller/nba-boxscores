// Playing the game's shots back in order, with the clock and score
// following along: speed, pausing, and seeking.
import { periodLabel } from "../lib/format.js";
import { loadPref, savePref } from "../lib/prefs.js";
import { clearFlights, flightDuration, launchShot, settleDuration } from "./flights.js";
import { shotData } from "./games.js";
import { followPlay } from "./pbp.js";
import { fgLabel, shotsByTeam } from "./shotchart.js";
import { state } from "./state.js";
import { hideTooltip } from "./tooltip.js";
import { applyTrendPlayhead, gameSeconds, periodLength, periodStart, selectedWindow } from "./trend.js";
import { drawZones, showZones } from "./zones.js";

// Shot chart playback: starting from blank courts, reveals each shot in game
// order, one at a time across both charts. The game clock holds while a shot
// is in flight, and runs faster between shots so a 12-minute quarter still
// takes about 30 seconds in total.

const PLAY_MS_PER_GAME_SECOND = 30_000 / 720;

// The clock always keeps at least this share of the time budget, so busy
// quarters run a little long rather than jumping straight from shot to shot.
const MIN_CLOCK_SHARE = 0.25;

// After a shot lands, how long its after-effects take: a make's burst ring, a
// miss's arc fading out. The next shot waits for them.
export const MAKE_SETTLE_MS = 450;
export const MISS_SETTLE_MS = 250;

// Shots that just appear (no flight) still get a beat before the next one.
export const SHOT_GAP_MS = 150;

// Busy quarters speed the shot animations up to fit the time budget, but never
// past this fraction of their normal length.
const MIN_PACE = 0.6;

// How fast playback runs, picked with the speed button: the clock and the
// shot animations both run this many times faster. Remembered.
// The button steps through them in order, wrapping around: from the default
// 1×, up to 4×, then down to half speed.
const PLAYBACK_RATES = [1, 2, 4, 0.5];
export let playbackRate = 1;
const savedSpeed = loadPref("speed", 1);
if (PLAYBACK_RATES.includes(savedSpeed)) {
  playbackRate = savedSpeed;
}

// Scales an animation length by the current playback's pace and speed. A
// shot replayed on its own (no playback) keeps its normal length.
export function paced(ms) {
  if (!playback) {
    return ms;
  }

  return (ms * playback.pace) / playbackRate;
}

// The CSS animations (shots landing) follow the same pace and speed.
function applyPace() {
  document.getElementById("shotcharts")?.style.setProperty("--pace", playback.pace / playbackRate);
}

// "2×", or "½×" for half speed.
export function speedLabel(rate) {
  if (rate === 0.5) {
    return "½×";
  }
  return `${rate}×`;
}

// Steps to the next speed, wrapping back to 1×. Takes effect immediately,
// even mid-playback.
export function cycleSpeed(event) {
  const button = event.target.closest("#speedButton");
  if (!button) {
    return;
  }

  playbackRate = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(playbackRate) + 1) % PLAYBACK_RATES.length];
  savePref("speed", playbackRate);
  track("playback_speed", { rate: playbackRate });
  button.textContent = speedLabel(playbackRate);
  button.setAttribute("aria-label", `Playback speed ${speedLabel(playbackRate)}`);
  if (playback) {
    applyPace();
  }
}

export const PLAY_LABELS = {
  play: '<span aria-hidden="true">▶</span> Play',
  pause: '<span aria-hidden="true">❚❚</span> Pause',
  replay: '<span aria-hidden="true">↺</span> Replay',
};

// While a playback exists (playing or paused): { t0, t1, lastPeriod, playhead,
// speed, jump, pace, frame, lastFrame, shots, next, inFlight }. `shots` are both
// teams' shots in order; `next` is how many have been launched.
export let playback = null;

export function playButton() {
  return document.getElementById("playButton");
}

// "Q2 · 7:31" for a time in seconds since tip-off. The end of a period is also
// the start of the next, so stay on lastPeriod at the window's end ("Q1 · 0:00").
function clockLabel(t, lastPeriod) {
  let period = 1;
  while (t >= periodStart(period) + periodLength(period) && period < lastPeriod) {
    period++;
  }
  const left = Math.max(0, Math.ceil(periodStart(period) + periodLength(period) - t));
  return `${periodLabel(period)} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

// Updates each chart's FG count, the clock, and the trend to
// match the shots launched so far.
function renderPlayhead() {
  const launched = playback.shots.slice(0, playback.next);
  for (const fg of document.querySelectorAll("#shotcharts .fg")) {
    const own = launched.filter((s) => String(s.team.id) === fg.dataset.team);
    const made = own.filter((s) => s.shot.made).length;
    fg.textContent = fgLabel(made, own.length);
  }
  document.getElementById("playClock").textContent = clockLabel(Math.min(playback.playhead, playback.t1), playback.lastPeriod);
  applyTrendPlayhead();
  if (showZones && playback.zoneCount !== playback.next) {
    playback.zoneCount = playback.next;
    drawZones();
  }
}

export function teamById(id) {
  const { away, home } = state.currentGame;
  return [away, home].find((t) => String(t.id) === String(id));
}

// Starts the next shot's flight; the clock resumes once it has landed.
function launchNext() {
  const run = playback;
  const entry = playback.shots[playback.next];
  playback.next++;
  followPlay(entry.shot.play_id);
  playback.inFlight = true;
  playback.atRim = false;
  launchShot(entry.mark).then(() => {
    if (run === playback) {
      playback.inFlight = false;
    }
  });
}

function tick(now) {
  // Frame timestamps can trail performance.now() (Firefox), so never step backward.
  const elapsed = Math.max(now - playback.lastFrame, 0);
  playback.lastFrame = now;
  if (!playback.inFlight) {
    // Run the clock up to the next shot (or the end), then launch it.
    const next = playback.shots[playback.next];
    const target = next ? next.t : playback.t1;
    if (playback.jump) {
      playback.playhead = target;
    } else {
      playback.playhead = Math.min(playback.playhead + (elapsed / 1000) * playback.speed * playbackRate, target);
    }
    if (next && playback.playhead >= next.t) {
      launchNext();
    }
  }
  renderPlayhead();
  if (playback.playhead >= playback.t1 && !playback.inFlight) {
    playback.frame = null;
    playButton().innerHTML = PLAY_LABELS.replay;
    playButton().setAttribute("aria-pressed", "false");
    return;
  }

  playback.frame = requestAnimationFrame(tick);
}

function resumePlayback() {
  playback.lastFrame = performance.now();
  playback.frame = requestAnimationFrame(tick);
  playButton().innerHTML = PLAY_LABELS.pause;
  playButton().setAttribute("aria-pressed", "true");
}

export function pausePlayback() {
  cancelAnimationFrame(playback.frame);
  playback.frame = null;
  playButton().innerHTML = PLAY_LABELS.play;
  playButton().setAttribute("aria-pressed", "false");
}

// Play starts from blank courts (or resumes if paused); Pause holds the
// current shots; Replay starts over.
export function togglePlayback(event) {
  if (!event.target.closest("#playButton") || !shotData) {
    return;
  }

  if (playback?.frame) {
    track("playback", { action: "pause", playhead: playback.playhead });
    pausePlayback();
    return;
  }

  if (playback) {
    let action = "resume";
    if (playback.playhead >= playback.t1) {
      action = "replay";
    }
    track("playback", { action, period: state.selectedPeriod, players: [...state.selectedPlayers] });
  } else {
    track("playback", { action: "play", period: state.selectedPeriod, players: [...state.selectedPlayers] });
  }
  // Playback animates the shot charts, so show them.
  document.getElementById("shotchartsSection").open = true;

  if (!playback || playback.playhead >= playback.t1) {
    startPlayback();
  }
  resumePlayback();
}

// Sets up a playback, paused at the start of the selected window: blank
// courts, both teams' shots queued in the order they happened.
function startPlayback() {
  const { last, t0, t1 } = selectedWindow();
  // Both teams' shots in the selected quarter, in the order they happened.
  const charts = document.getElementById("shotcharts");
  const shots = [...shotsByTeam].flatMap(([teamId, teamShots]) => teamShots.map((shot, i) => ({
    shot,
    team: teamById(teamId),
    t: gameSeconds(shot),
    mark: charts.querySelector(`.shot[data-team="${teamId}"][data-shot="${i}"]`),
  }))).sort((a, b) => a.t - b.t);
  for (const { mark } of shots) {
    mark.classList.remove("revealed", "burst");
  }

  // Fit flights plus clock time into the budget for this span of the game.
  // Speed animations up if they'd crowd out the clock, then give the clock the
  // rest. Picked players' shots are few, so they just play back to back at
  // full animation length, the clock jumping from shot to shot.
  const jump = state.selectedPlayers.size > 0;
  const budget = (t1 - t0) * PLAY_MS_PER_GAME_SECOND;
  const flying = shots.reduce((sum, s) => sum + flightDuration(s.shot) + settleDuration(s.shot), 0);
  const room = budget * (1 - MIN_CLOCK_SHARE);
  let pace = Math.max(Math.min(room / flying, 1), MIN_PACE);
  if (jump) {
    pace = 1;
  }
  const clockMs = Math.max(budget - flying * pace, budget * MIN_CLOCK_SHARE);
  playback = {
    t0,
    t1,
    lastPeriod: last,
    playhead: t0,
    speed: (t1 - t0) / (clockMs / 1000),
    jump,
    pace,
    frame: null,
    lastFrame: 0,
    shots,
    next: 0,
    inFlight: false,
  };
  applyPace();
  clearFlights();
  document.getElementById("shotcharts").classList.add("animating");
  hideTooltip();
  renderPlayhead();
}

// Puts the court at the moment a shot was taken: the shots before it shown,
// and the clock, score, FG counts, and zones as they stood, with the shot
// itself flying in. Playback stays paused there, and Play carries on from it.
export function seekToShot(mark) {
  ensurePlayback();
  const index = playback.shots.findIndex((entry) => entry.mark === mark);
  if (index === -1) {
    return;
  }

  jumpPlayback(index, playback.shots[index].t);
  launchNext();
  renderPlayhead();
}

// Puts the court just after a play that isn't a shot on the chart, like a
// made free throw: every shot taken by then shown, and the clock, score, FG
// counts, and zones as they stood. Playback stays paused there.
export function seekToPlay(play) {
  ensurePlayback();
  const t = gameSeconds(play);
  if (t < playback.t0 || t > playback.t1) {
    return;
  }

  // Shots are in game order; those at the play's own second came first (an
  // and-one's basket before its free throw).
  jumpPlayback(playback.shots.filter((entry) => entry.t <= t).length, t);
  renderPlayhead();
}

// A paused playback to jump around in: the current one, or a new one if
// there's none or it has finished.
function ensurePlayback() {
  if (!playback || playback.playhead >= playback.t1) {
    startPlayback();
  }
}

// Moves the paused playback to game time t, with the first `next` shots
// shown and the rest still to come.
function jumpPlayback(next, t) {
  // A new run, so flights from before the jump can't reveal shots or end
  // a later one's flight when they land.
  playback = { ...playback, frame: null, inFlight: false };
  clearFlights();
  playback.shots.forEach((entry, i) => {
    entry.mark.classList.toggle("revealed", i < next);
    entry.mark.classList.remove("burst", "replaying");
  });
  playback.next = next;
  playback.playhead = t;
  playButton().innerHTML = PLAY_LABELS.play;
  playButton().setAttribute("aria-pressed", "false");
}

// Ends any playback and shows every shot again, e.g. when the quarter or game changes.
export function stopPlayback() {
  if (!playback) {
    return;
  }

  cancelAnimationFrame(playback.frame);
  playback = null;
  clearFlights();
  document.getElementById("shotcharts")?.classList.remove("animating");
  const button = playButton();
  if (button) {
    button.innerHTML = PLAY_LABELS.play;
    button.setAttribute("aria-pressed", "false");
  }
  const clock = document.getElementById("playClock");
  if (clock) {
    clock.textContent = "";
  }
  for (const slot of document.querySelectorAll("#shotcharts .shooter")) {
    slot.textContent = "";
  }
  for (const row of document.querySelectorAll("#playbyplay tr.current")) {
    row.classList.remove("current");
  }
  applyTrendPlayhead();
  if (showZones) {
    drawZones();
  }
}
