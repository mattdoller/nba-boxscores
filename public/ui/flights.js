// Shots flying from the shooter to the rim, and what lands with them: the
// mark, the score, and the shooter's name.
import { FLOOR_SQUASH, projectHalf } from "../lib/court.js";
import { escapeHtml, round1 } from "../lib/format.js";
import { playerKey } from "./filters.js";
import { pathFrom, RIM_HEIGHT } from "./floor.js";
import { followPlay } from "./pbp.js";
import { MAKE_SETTLE_MS, MISS_SETTLE_MS, paced, playback, SHOT_GAP_MS } from "./playback.js";
import { shootingLabel, shotsByTeam } from "./shotchart.js";
import { hideTooltip } from "./tooltip.js";
import { applyTrendPlayhead } from "./trend.js";
import { pulseZone } from "./zones.js";

// Shot flights: as playback reveals a shot, it flies from the shot spot to the
// hoop on a parabola through the air. On a make a basketball rides it with a
// shadow sliding along the floor beneath, the rim flashes, and the dot lands
// with a big burst; a miss draws a gray arc that comes down just off the rim.
// Flights keep going while paused, since they're short.

export const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const SVG_NS = "http://www.w3.org/2000/svg";

export function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  return el;
}

// Shots right under the rim have no room for an arc; reveal them at once.
const MIN_FLIGHT_DISTANCE = 20;

// Shots leave the hand about 8 ft up and peak higher the longer they are:
// roughly 13 ft for a layup, 17 ft for a three.
const RELEASE_HEIGHT = 80;
const FLIGHT_STEPS = 40;

// The flight as points from release (u = 0) to the end (u = 1), each with
// where it is in the air and its shadow on the floor, both on screen.
function flightPoints(side, shot, endX, endY) {
  const distance = Math.hypot(shot.x - endX, shot.y - endY);
  const rise = 25 + distance * 0.2;
  const points = [];
  for (let i = 0; i <= FLIGHT_STEPS; i++) {
    const u = i / FLIGHT_STEPS;
    const hx = shot.x + (endX - shot.x) * u;
    const hy = shot.y + (endY - shot.y) * u;
    const z = RELEASE_HEIGHT + (RIM_HEIGHT - RELEASE_HEIGHT) * u + 4 * rise * u * (1 - u);
    points.push({ air: projectHalf(side, hx, hy, z), ground: projectHalf(side, hx, hy), z });
  }
  return points;
}

// The point a fraction u of the way along the flight, between samples.
function flightAt(points, u) {
  const i = Math.min(Math.floor(u * FLIGHT_STEPS), FLIGHT_STEPS - 1);
  const f = u * FLIGHT_STEPS - i;
  const mix = (a, b) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, scale: a.scale + (b.scale - a.scale) * f });
  return { air: mix(points[i].air, points[i + 1].air), ground: mix(points[i].ground, points[i + 1].ground), z: points[i].z + (points[i + 1].z - points[i].z) * f };
}

// Flights from an earlier run (before Replay or a stop) must not reveal anything.
function revealMark(mark, burst, run = playback) {
  if (run !== playback) {
    return;
  }
  mark.classList.add("revealed");
  mark.classList.toggle("burst", burst);
}

// How long a shot's flight takes before it lands (0 when it just appears).
export function flightDuration(shot) {
  const distance = Math.hypot(shot.x, shot.y);
  if (reduceMotion.matches || distance < MIN_FLIGHT_DISTANCE) {
    return 0;
  }
  return Math.min(350 + distance * 1.2, 750);
}

export function settleDuration(shot) {
  if (flightDuration(shot) === 0) {
    return SHOT_GAP_MS;
  }
  return shot.made ? MAKE_SETTLE_MS : MISS_SETTLE_MS;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function madeVar(color) {
  if (!color) {
    return "";
  }
  return `--made: ${color}`;
}

// Animates one shot and resolves shortly after it lands.
// Names the player taking a shot in their team's caption, and clears the
// other team's, so only the current shooter is named. A caption already
// showing that one player's name is left alone.
// Their shooting line counts the same shots as the team's beside it: those
// launched so far during playback, otherwise every shot on the chart.
function showShooter(mark, shot) {
  const charts = mark.closest("#shotcharts");
  let shots = shotsByTeam.get(mark.dataset.team) ?? [];
  if (playback) {
    shots = playback.shots.slice(0, playback.next).map((entry) => entry.shot);
  }
  const own = shots.filter((s) => playerKey(s) === playerKey(shot));
  const line = shootingLabel(own.filter((s) => s.made).length, own.length);

  for (const slot of charts.querySelectorAll(".court-team .shooter")) {
    const caption = slot.parentElement.querySelector("strong").textContent;
    slot.innerHTML = "";
    if (slot.dataset.team === mark.dataset.team && shot.player !== caption) {
      slot.innerHTML = `<span class="shooter-name">${escapeHtml(shot.player)}</span> <span class="shooter-fg">${line}</span>`;
    }
  }
}

// The shot in the air has reached the hoop: its points count from now, so
// the trends climb as the make bursts instead of after it settles. `run` is
// the playback that launched the shot; a replayed shot or a stopped run
// changes nothing.
function reachRim(run) {
  if (!run || run !== playback) {
    return;
  }

  playback.atRim = true;
  applyTrendPlayhead();
}

// True while a shot is in the air and hasn't reached the hoop. The playhead
// waits at the shot's moment meanwhile, and scores from that moment (the
// shot, and any free throws after it) are held back.
export function scoreHeld() {
  return Boolean(playback?.inFlight && !playback.atRim);
}

export function launchShot(mark) {
  const shot = shotsByTeam.get(mark.dataset.team)?.[mark.dataset.shot];
  if (shot) {
    showShooter(mark, shot);
    pulseZone(mark, shot);
  }
  const flights = mark.ownerSVGElement.querySelector(".flights");
  const side = mark.closest(".half").dataset.side;
  const duration = shot ? paced(flightDuration(shot)) : 0;
  if (duration === 0) {
    revealMark(mark, false);
    reachRim(playback);
    return wait(paced(SHOT_GAP_MS));
  }

  // Misses come down just beside the rim, on a side that varies shot to shot.
  let endX = 0;
  let endY = 0;
  if (!shot.made) {
    const sideways = Number(mark.dataset.shot) % 2 === 0 ? 1 : -1;
    endX = sideways * 14;
    endY = 6;
  }

  const run = playback;
  const points = flightPoints(side, shot, endX, endY);
  // Flights sit above both halves, so they take the team color from the shot's half.
  const teamColor = mark.closest(".half").style.getPropertyValue("--made");
  const arc = svgEl("path", { class: `flight-arc ${shot.made ? "made" : "missed"}`, d: "", style: madeVar(teamColor) });
  flights.append(arc);
  let ball = null;
  let shadow = null;
  if (shot.made) {
    shadow = svgEl("ellipse", { class: "ball-shadow" });
    ball = svgEl("circle", { class: "flight-ball" });
    flights.append(shadow, ball);
  }

  const start = performance.now();
  let landed;
  const done = new Promise((resolve) => {
    landed = resolve;
  });
  const step = (now) => {
    // Cleared by a stop or Replay: nothing is waiting on this flight any more.
    if (!arc.isConnected) {
      landed();
      return;
    }

    // The arc draws behind the ball; horizontal speed is constant, like a real shot.
    // Firefox can stamp the first frame slightly before `start`, so clamp at 0.
    const u = Math.min(Math.max((now - start) / duration, 0), 1);
    const here = flightAt(points, u);
    const drawn = points.slice(0, Math.floor(u * FLIGHT_STEPS) + 1).map((p) => p.air);
    arc.setAttribute("d", pathFrom([...drawn, here.air]));
    if (ball) {
      ball.setAttribute("cx", here.air.x);
      ball.setAttribute("cy", here.air.y);
      ball.setAttribute("r", round1(7.5 * here.air.scale));
      // The shadow fades and shrinks as the ball rises.
      const lift = Math.min(here.z / 200, 1);
      const rx = round1(7 * here.ground.scale * (1 - lift * 0.4));
      shadow.setAttribute("cx", here.ground.x);
      shadow.setAttribute("cy", here.ground.y);
      shadow.setAttribute("rx", rx);
      shadow.setAttribute("ry", round1(rx * FLOOR_SQUASH));
      shadow.setAttribute("opacity", round1((0.35 - lift * 0.2) * 100) / 100);
    }
    if (u < 1) {
      requestAnimationFrame(step);
      return;
    }

    reachRim(run);
    const settle = paced(settleDuration(shot));
    arc.animate([{ opacity: 0.7 }, { opacity: 0 }], { duration: settle, fill: "forwards" })
      .finished.then(() => arc.remove(), () => {});
    if (!shot.made) {
      revealMark(mark, false, run);
      wait(settle).then(landed);
      return;
    }

    ball.remove();
    shadow.remove();
    // Swish: a ring flashes at the rim, then the make lands with a burst.
    const rim = projectHalf(side, 0, 0, RIM_HEIGHT);
    const spot = projectHalf(side, shot.x, shot.y);
    const ring = (className, p, size) => {
      const rx = round1(size * p.scale);
      const el = svgEl("ellipse", { class: className, cx: p.x, cy: p.y, rx, ry: round1(rx * FLOOR_SQUASH), style: madeVar(teamColor) });
      flights.append(el);
      return el;
    };
    ring("rim-flash", rim, 10).animate([{ opacity: 1, transform: "scale(0.6)" }, { opacity: 0, transform: "scale(2.6)" }], { duration: settle, easing: "ease-out" })
      .finished.then((a) => a.effect.target.remove(), () => {});
    ring("make-burst", spot, 10).animate([{ opacity: 0.9, transform: "scale(0.6)" }, { opacity: 0, transform: "scale(5)" }], { duration: settle, easing: "ease-out" })
      .finished.then((a) => a.effect.target.remove(), () => {});
    if (shot.type === "3PT Field Goal") {
      pulseThreePointLine(flights, side, teamColor, settle);
    }
    revealMark(mark, true, run);
    wait(settle).then(landed);
  };
  requestAnimationFrame(step);
  return done;
}

// A made three lights up the three-point line it was shot from: a copy of
// the line in the team's color flashes over it and fades, alongside the make's
// burst and for as long.
function pulseThreePointLine(flights, side, teamColor, duration) {
  const line = flights.ownerSVGElement.querySelector(`.three-point-line[data-side="${side}"]`);
  if (!line) {
    return;
  }

  const pulse = svgEl("path", { class: "three-point-pulse", d: line.getAttribute("d"), style: madeVar(teamColor) });
  flights.append(pulse);
  pulse.animate(
    [{ opacity: 1, strokeWidth: 3.5 }, { opacity: 0, strokeWidth: 12 }],
    { duration, easing: "ease-out" },
  ).finished.then(() => pulse.remove(), () => {});
}

// Clicking a shot replays its flight.
export function replayShot(event) {
  const mark = event.target.closest?.(".shot");
  if (mark) {
    followPlay(mark.dataset.play);
    replayMark(mark, "shot");
  }
}

// Replays a shot's flight, unless playback is running (its shots fly one at
// a time, and a replay would cut in). `source` says what asked, for tracking.
function replayMark(mark, source) {
  if (playback?.frame || playback?.inFlight || mark.classList.contains("replaying")) {
    return;
  }

  const shot = shotsByTeam.get(mark.dataset.team)?.[Number(mark.dataset.shot)];
  track("shot_replay", {
    source,
    team_id: Number(mark.dataset.team),
    player: shot?.player,
    period: shot?.period,
    clock: shot?.clock,
    made: shot?.made,
  });
  hideTooltip();
  mark.classList.remove("revealed", "burst");
  mark.classList.add("replaying");
  launchShot(mark).then(() => {
    mark.classList.remove("replaying");
    // Outside playback a shot needs no reveal state; inside it (paused), keep it shown.
    if (!playback) {
      mark.classList.remove("revealed", "burst");
    }
  });
}

export function clearFlights() {
  for (const flights of document.querySelectorAll("#shotcharts .flights")) {
    flights.replaceChildren();
  }
}
