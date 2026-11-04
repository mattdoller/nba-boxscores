// Fake games for trying the app without stats.nba.com: real teams with
// made-up players, schedules, and games, as the JSON stats.nba.com would
// send. bin/load-fixtures caches it so the server can serve it.
//
// Each game is simulated possession by possession, and its play-by-play,
// shot chart, box score, and line score are all built from that one
// simulation, so they agree with each other. Players keep a profile (how
// much they shoot, from where, how well) across games, so a season adds up
// to plausible numbers.
import { getTeams } from "../nba-api/static/teams.js";
import { zoneAt } from "../public/lib/zones.js";

const FIRST_NAMES = [
  "Aaron", "Andre", "Bennett", "Calvin", "Cameron", "Darius", "Dante", "Desmond", "Elijah", "Emeka",
  "Felix", "Gavin", "Grant", "Hassan", "Isaiah", "Jalen", "Jamal", "Jordan", "Julian", "Kendall",
  "Keon", "Lamar", "Luca", "Malik", "Marcus", "Mason", "Miles", "Nico", "Omar", "Oscar",
  "Quinn", "Reggie", "Rashad", "Rowan", "Silas", "Terrence", "Theo", "Tobias", "Trey", "Tyrell",
  "Victor", "Wade", "Xavier", "Yusuf", "Zion", "Damon", "Ellis", "Jasper", "Kofi", "Rafael",
];

const LAST_NAMES = [
  "Abernathy", "Ashford", "Banks", "Bellamy", "Blackwood", "Calloway", "Carver", "Castellano", "Delacroix", "Draper",
  "Easterly", "Fairbanks", "Fontaine", "Galloway", "Garrity", "Halvorsen", "Hargrove", "Holloway", "Iverly", "Jennings",
  "Kessler", "Kingsley", "Lancaster", "Lockhart", "Mabry", "Merriweather", "Mosley", "Nwachukwu", "Okafor", "Oduya",
  "Pemberton", "Prescott", "Quarles", "Radcliffe", "Rhodes", "Sandoval", "Sterling", "Thibault", "Underwood", "Vance",
  "Wakefield", "Whitlock", "Yarbrough", "Zeller", "Ambrose", "Brightwater", "Coleridge", "Dunmore", "Everhart", "Stroud",
];

// Positions for a 13-man roster, starters first.
const ROSTER_POSITIONS = ["G", "G", "F", "F", "C", "G", "F", "C", "G", "F", "F", "G", "C"];

// Minutes a roster spot plays in a regulation game, before randomness. The
// last two are usually healthy scratches.
const ROTATION_MINUTES = [34, 32, 32, 30, 28, 24, 22, 18, 12, 8, 0, 0, 0];

const PERIOD_SECONDS = 720;

// How long a possession takes, from shortest to longest: about 100 a game
// for each team, as in the NBA.
const POSSESSION_SECONDS = [6, 23];
const OVERTIME_SECONDS = 300;

// How often a possession ends each way, before the shot itself.
const TURNOVER_RATE = 0.13;
const SHOOTING_FOUL_RATE = 0.09;
const AND_ONE_RATE = 0.05;
const OFFENSIVE_REBOUND_RATE = 0.25;
const ASSIST_RATE = 0.6;
const STEAL_SHARE = 0.5;
const BLOCK_RATE = 0.07;

// League-like make rates by where a shot comes from.
const MAKE_RATES = { rim: 0.64, paint: 0.43, mid: 0.42, corner3: 0.39, arc3: 0.36 };

// Seeded pseudo-random numbers (mulberry32), so a seed always makes the
// same season.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTools(random) {
  const between = (low, high) => low + random() * (high - low);
  const int = (low, high) => Math.floor(between(low, high + 1));
  const chance = (p) => random() < p;
  const pick = (items) => items[Math.floor(random() * items.length)];
  // One item, more likely the heavier its weight.
  const weighted = (items, weight) => {
    const total = items.reduce((sum, item) => sum + weight(item), 0);
    let roll = random() * total;
    for (const item of items) {
      roll -= weight(item);
      if (roll <= 0) {
        return item;
      }
    }
    return items.at(-1);
  };
  return { between, int, chance, pick, weighted };
}

// `usedNames` holds full names already given out, so no two players in the
// league share one. Last names are unique within a team, since the
// play-by-play calls players by last name.
function makeRoster(team, teamIndex, tools, usedNames) {
  const { between, int, pick } = tools;
  const usedNumbers = new Set();
  const teamLastNames = new Set();
  const star = int(0, 2);
  return ROSTER_POSITIONS.map((position, i) => {
    let number = int(0, 55);
    while (usedNumbers.has(number)) {
      number = int(0, 55);
    }
    usedNumbers.add(number);

    const big = position === "C";
    const guard = position === "G";
    let usage = between(0.5, 1);
    if (i < 5) {
      usage = between(1, 1.5);
    }
    if (i === star) {
      usage = 2.2;
    }
    let first = pick(FIRST_NAMES);
    let last = pick(LAST_NAMES);
    while (usedNames.has(`${first} ${last}`) || teamLastNames.has(last)) {
      first = pick(FIRST_NAMES);
      last = pick(LAST_NAMES);
    }
    usedNames.add(`${first} ${last}`);
    teamLastNames.add(last);
    return {
      id: 9_000_000 + teamIndex * 100 + i + 1,
      teamId: team.id,
      first,
      last,
      position,
      number: String(number),
      starter: i < 5,
      minutes: ROTATION_MINUTES[i],
      usage,
      threeRate: Math.max(0.02, (big ? 0.12 : guard ? 0.45 : 0.38) + between(-0.12, 0.12)),
      rimRate: (big ? 0.7 : guard ? 0.4 : 0.5) + between(-0.1, 0.1),
      shooting: between(-0.06, 0.06),
      freeThrow: (big ? 0.68 : 0.8) + between(-0.1, 0.1),
      rebounding: (big ? 3 : guard ? 1 : 2) * between(0.7, 1.3),
      passing: (guard ? 2.5 : big ? 0.8 : 1.2) * between(0.7, 1.3),
      defense: between(0.6, 1.4),
    };
  });
}

// Every team plays every round against a random opponent; rounds are two
// days apart from opening night.
function makeSchedule(teams, rounds, season, tools) {
  const games = [];
  const opener = new Date(Date.UTC(season, 9, 21));
  for (let round = 0; round < rounds; round++) {
    const order = [...teams].sort(() => tools.between(-1, 1));
    const date = new Date(opener.getTime() + round * 2 * 86_400_000).toISOString().slice(0, 10);
    for (let i = 0; i < order.length; i += 2) {
      games.push({ date, home: order[i], away: order[i + 1] });
    }
  }
  return games;
}

function clockString(secondsLeft) {
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft - minutes * 60;
  return `PT${String(minutes).padStart(2, "0")}M${seconds.toFixed(2).padStart(5, "0")}S`;
}

function periodName(period) {
  const names = ["1st", "2nd", "3rd", "4th"];
  if (period <= 4) {
    return `${names[period - 1]} Period`;
  }
  return `${["1st", "2nd", "3rd"][period - 5] ?? `${period - 4}th`} OT`;
}

// Where a shot is taken from, in stats.nba.com's shot chart coordinates
// (tenths of a foot, hoop at 0, 0), for each kind of shot.
function shotSpot(kind, tools) {
  const { between, chance } = tools;
  const atAngle = (distance, maxAngle) => {
    const angle = (between(-maxAngle, maxAngle) * Math.PI) / 180;
    // Kept inside the sidelines, where every spot is in a zone.
    const x = Math.max(-248, Math.min(248, Math.round(distance * Math.sin(angle))));
    return [x, Math.round(distance * Math.cos(angle))];
  };
  if (kind === "rim") {
    return atAngle(between(0, 38), 80);
  }
  if (kind === "paint") {
    return [Math.round(between(-75, 75)), Math.round(between(20, 135))];
  }
  if (kind === "mid") {
    return atAngle(between(90, 225), 80);
  }
  if (kind === "corner3") {
    const side = chance(0.5) ? 1 : -1;
    return [side * Math.round(between(222, 245)), Math.round(between(-40, 85))];
  }
  const [x, y] = atAngle(between(240, 275), 68);
  return [x, Math.max(y, 95)];
}

function zoneKind(zone) {
  if (zone.startsWith("Restricted")) {
    return "rim";
  }
  if (zone.startsWith("In The Paint")) {
    return "paint";
  }
  if (zone.startsWith("Mid-Range")) {
    return "mid";
  }
  if (zone.includes("Corner 3")) {
    return "corner3";
  }
  return "arc3";
}

function zoneRange(feet, isThree) {
  if (isThree) {
    return "24+ ft.";
  }
  if (feet < 8) {
    return "Less Than 8 ft.";
  }
  if (feet < 16) {
    return "8-16 ft.";
  }
  return "16-24 ft.";
}

function shotAction(kind, tools) {
  if (kind === "rim") {
    return tools.pick(["Layup Shot", "Driving Layup Shot", "Dunk Shot", "Cutting Layup Shot", "Tip Layup Shot"]);
  }
  if (kind === "paint") {
    return tools.pick(["Floating Jump shot", "Driving Floating Jump Shot", "Turnaround Hook Shot", "Hook Shot"]);
  }
  if (kind === "mid") {
    return tools.pick(["Jump Shot", "Pullup Jump shot", "Turnaround Fadeaway shot", "Step Back Jump shot"]);
  }
  return tools.pick(["Jump Shot", "Pullup Jump shot", "Step Back Jump shot", "Running Jump Shot"]);
}

// A field goal attempt from somewhere fitting the shooter: its spot, zone,
// distance in feet, kind of shot, and whether it went in. `drift` nudges the
// shooter's touch, for seasons other than the simulated one.
function takeShot(shooter, tools, drift = 0) {
  const { chance } = tools;
  let kind = "arc3";
  if (!chance(shooter.threeRate)) {
    kind = chance(shooter.rimRate) ? "rim" : tools.pick(["paint", "mid", "mid"]);
  } else if (chance(0.25)) {
    kind = "corner3";
  }
  const [x, y] = shotSpot(kind, tools);
  const zone = zoneAt(x, y);
  const actual = zoneKind(zone);
  const isThree = actual === "corner3" || actual === "arc3";
  const feet = Math.round(Math.hypot(x, y) / 10);
  const action = shotAction(actual, tools);
  const made = chance(MAKE_RATES[actual] + shooter.shooting + drift);
  return { x, y, zone, isThree, feet, action, made };
}

const STAT_KEYS = [
  "fieldGoalsMade", "fieldGoalsAttempted", "threePointersMade", "threePointersAttempted",
  "freeThrowsMade", "freeThrowsAttempted", "reboundsOffensive", "reboundsDefensive",
  "assists", "steals", "blocks", "turnovers", "foulsPersonal", "points", "plusMinusPoints",
];

function emptyLine() {
  return Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
}

function percentage(made, attempted) {
  if (attempted === 0) {
    return 0;
  }
  return Math.round((made / attempted) * 1000) / 1000;
}

function minutesString(seconds) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Plays one game. Returns its actions (play-by-play), shots, each player's
// line, and the score by period.
function simulateGame(game, rosters, tools) {
  const { between, int, chance, weighted } = tools;
  const sides = { home: game.home, away: game.away };
  const teamOf = { home: rosters.get(game.home.id), away: rosters.get(game.away.id) };
  const lines = new Map([...teamOf.home, ...teamOf.away].map((p) => [p.id, emptyLine()]));
  const score = { home: 0, away: 0 };
  const periodScores = { home: [], away: [] };
  const actions = [];
  const shots = [];
  let actionNumber = 0;

  // Tonight's minutes: the rotation with some noise; a couple of scratches.
  const minutesTonight = new Map();
  for (const side of ["home", "away"]) {
    for (const player of teamOf[side]) {
      let minutes = player.minutes;
      if (minutes > 0) {
        minutes = Math.max(4, minutes + between(-5, 5));
      }
      minutesTonight.set(player.id, minutes);
    }
  }

  const add = (period, clock, fields) => {
    actionNumber++;
    actions.push({
      actionNumber,
      clock: clockString(clock),
      period,
      teamId: 0,
      teamTricode: "",
      personId: 0,
      playerName: "",
      playerNameI: "",
      xLegacy: 0,
      yLegacy: 0,
      shotDistance: 0,
      shotResult: "",
      isFieldGoal: 0,
      scoreHome: String(score.home),
      scoreAway: String(score.away),
      pointsTotal: score.home + score.away,
      location: "",
      description: "",
      actionType: "",
      subType: "",
      videoAvailable: 0,
      shotValue: 0,
      actionId: actionNumber,
      ...fields,
    });
    return actionNumber;
  };

  const byPlayer = (player, side) => ({
    teamId: sides[side].id,
    teamTricode: sides[side].abbreviation,
    personId: player.id,
    playerName: player.last,
    playerNameI: `${player.first[0]}. ${player.last}`,
    location: side === "home" ? "h" : "v",
  });

  // Five players, more likely the more minutes they're down for.
  const lineup = (side) => {
    const pool = teamOf[side].filter((p) => minutesTonight.get(p.id) > 0);
    const chosen = [];
    while (chosen.length < 5) {
      const player = weighted(pool.filter((p) => !chosen.includes(p)), (p) => minutesTonight.get(p.id));
      chosen.push(player);
    }
    return chosen;
  };

  const other = (side) => (side === "home" ? "away" : "home");

  const freeThrows = (period, clock, shooter, side, count) => {
    let points = 0;
    let lastMissed = false;
    for (let n = 1; n <= count; n++) {
      const line = lines.get(shooter.id);
      line.freeThrowsAttempted++;
      const made = chance(shooter.freeThrow);
      lastMissed = !made;
      let description = `MISS ${shooter.last} Free Throw ${n} of ${count}`;
      if (made) {
        line.freeThrowsMade++;
        line.points++;
        score[side]++;
        points++;
        description = `${shooter.last} Free Throw ${n} of ${count} (${line.points} PTS)`;
      }
      add(period, clock, {
        ...byPlayer(shooter, side),
        description,
        actionType: "Free Throw",
        subType: `Free Throw ${n} of ${count}`,
      });
    }
    return { points, lastMissed };
  };

  const rebound = (period, clock, offense, defense, side) => {
    const offensive = chance(OFFENSIVE_REBOUND_RATE);
    const team = offensive ? offense : defense;
    const teamSide = offensive ? side : other(side);
    const rebounder = weighted(team, (p) => p.rebounding);
    const line = lines.get(rebounder.id);
    if (offensive) {
      line.reboundsOffensive++;
    } else {
      line.reboundsDefensive++;
    }
    add(period, clock, {
      ...byPlayer(rebounder, teamSide),
      description: `${rebounder.last} REBOUND (Off:${line.reboundsOffensive} Def:${line.reboundsDefensive})`,
      actionType: "Rebound",
      subType: offensive ? "offensive" : "defensive",
    });
    return offensive;
  };

  // One possession for `side`; returns the points it scored.
  const possession = (period, clock, side, offense, defense) => {
    let points = 0;
    for (;;) {
      if (chance(TURNOVER_RATE)) {
        const loser = weighted(offense, (p) => p.usage);
        lines.get(loser.id).turnovers++;
        add(period, clock, {
          ...byPlayer(loser, side),
          description: `${loser.last} ${tools.pick(["Bad Pass", "Lost Ball", "Traveling", "Out of Bounds"])} Turnover (P1.T${lines.get(loser.id).turnovers})`,
          actionType: "Turnover",
          subType: "Bad Pass",
        });
        if (chance(STEAL_SHARE)) {
          const thief = weighted(defense, (p) => p.defense);
          lines.get(thief.id).steals++;
          add(period, clock, {
            ...byPlayer(thief, other(side)),
            description: `${thief.last} STEAL (${lines.get(thief.id).steals} STL)`,
            actionType: "Steal",
          });
        }
        return points;
      }

      const shooter = weighted(offense, (p) => p.usage);
      if (chance(SHOOTING_FOUL_RATE)) {
        const fouler = weighted(defense, (p) => p.defense);
        lines.get(fouler.id).foulsPersonal++;
        add(period, clock, {
          ...byPlayer(fouler, other(side)),
          description: `${fouler.last} S.FOUL (P${lines.get(fouler.id).foulsPersonal}.T1)`,
          actionType: "Foul",
          subType: "Shooting",
        });
        const result = freeThrows(period, clock, shooter, side, chance(shooter.threeRate) ? 3 : 2);
        points += result.points;
        if (!result.lastMissed || !rebound(period, clock, offense, defense, side)) {
          return points;
        }
        continue;
      }

      const { x, y, zone, isThree, feet, action, made } = takeShot(shooter, tools);
      const line = lines.get(shooter.id);
      line.fieldGoalsAttempted++;
      if (isThree) {
        line.threePointersAttempted++;
      }
      const value = isThree ? 3 : 2;
      const shotName = `${feet}' ${isThree ? "3PT " : ""}${action}`;
      let description = `MISS ${shooter.last} ${shotName}`;
      if (made) {
        line.fieldGoalsMade++;
        if (isThree) {
          line.threePointersMade++;
        }
        line.points += value;
        score[side] += value;
        points += value;
        description = `${shooter.last} ${shotName} (${line.points} PTS)`;
        if (chance(ASSIST_RATE)) {
          const assister = weighted(offense.filter((p) => p !== shooter), (p) => p.passing);
          const assists = ++lines.get(assister.id).assists;
          description += ` (${assister.last} ${assists} AST)`;
        }
      }
      const shotNumber = add(period, clock, {
        ...byPlayer(shooter, side),
        xLegacy: -x,
        yLegacy: y,
        shotDistance: feet,
        shotResult: made ? "Made" : "Missed",
        isFieldGoal: 1,
        description,
        actionType: made ? "Made Shot" : "Missed Shot",
        subType: action,
        shotValue: value,
      });
      shots.push({ actionNumber: shotNumber, period, clock, shooter, side, x, y, zone, feet, isThree, action, made });

      if (made) {
        if (!isThree && chance(AND_ONE_RATE)) {
          const fouler = weighted(defense, (p) => p.defense);
          lines.get(fouler.id).foulsPersonal++;
          add(period, clock, {
            ...byPlayer(fouler, other(side)),
            description: `${fouler.last} S.FOUL (P${lines.get(fouler.id).foulsPersonal}.T1)`,
            actionType: "Foul",
            subType: "Shooting",
          });
          points += freeThrows(period, clock, shooter, side, 1).points;
        }
        return points;
      }

      if (chance(BLOCK_RATE)) {
        const blocker = weighted(defense, (p) => p.rebounding);
        lines.get(blocker.id).blocks++;
        add(period, clock, {
          ...byPlayer(blocker, other(side)),
          description: `${blocker.last} BLOCK (${lines.get(blocker.id).blocks} BLK)`,
          actionType: "Block",
        });
      }
      if (!rebound(period, clock, offense, defense, side)) {
        return points;
      }
    }
  };

  // Tip-off, then possessions until each period's clock runs out, with
  // overtimes until someone leads.
  let side = chance(0.5) ? "home" : "away";
  const [homeCenter] = teamOf.home.filter((p) => p.position === "C");
  const [awayCenter] = teamOf.away.filter((p) => p.position === "C");
  const tippedTo = weighted(teamOf[side].filter((p) => p.starter), () => 1);
  for (let period = 1; period <= 4 || score.home === score.away; period++) {
    const length = period <= 4 ? PERIOD_SECONDS : OVERTIME_SECONDS;
    const before = { ...score };
    add(period, length, {
      description: `Start of ${periodName(period)} (${int(7, 9)}:${String(int(0, 59)).padStart(2, "0")} PM EST)`,
      actionType: "period",
      subType: "start",
    });
    if (period === 1) {
      add(period, length, {
        ...byPlayer(tippedTo, side),
        description: `Jump Ball ${homeCenter.last} vs. ${awayCenter.last}: Tip to ${tippedTo.last}`,
        actionType: "Jump Ball",
      });
    }
    let clock = length;
    while (clock > 0) {
      clock = Math.max(0, Math.round((clock - between(...POSSESSION_SECONDS)) * 10) / 10);
      const offense = lineup(side);
      const defense = lineup(other(side));
      const points = possession(period, clock, side, offense, defense);
      for (const player of offense) {
        lines.get(player.id).plusMinusPoints += points;
      }
      for (const player of defense) {
        lines.get(player.id).plusMinusPoints -= points;
      }
      side = other(side);
    }
    add(period, 0, {
      description: `End of ${periodName(period)}`,
      actionType: "period",
      subType: "end",
    });
    periodScores.home.push(score.home - before.home);
    periodScores.away.push(score.away - before.away);
  }

  // Minutes scale with overtime so each team's add up to the game's length.
  const periods = periodScores.home.length;
  const gameMinutes = 48 + (periods - 4) * 5;
  for (const side of ["home", "away"]) {
    const total = teamOf[side].reduce((sum, p) => sum + minutesTonight.get(p.id), 0);
    for (const player of teamOf[side]) {
      lines.get(player.id).seconds = (minutesTonight.get(player.id) / total) * gameMinutes * 5 * 60;
    }
  }

  return { actions, shots, lines, score, periodScores, minutesTonight };
}

function boxScoreTeam(team, roster, played) {
  const players = roster.map((player) => {
    const line = played.lines.get(player.id);
    const didPlay = played.minutesTonight.get(player.id) > 0;
    const statistics = {
      minutes: didPlay ? minutesString(line.seconds) : "",
      ...Object.fromEntries(STAT_KEYS.map((key) => [key, line[key]])),
      fieldGoalsPercentage: percentage(line.fieldGoalsMade, line.fieldGoalsAttempted),
      threePointersPercentage: percentage(line.threePointersMade, line.threePointersAttempted),
      freeThrowsPercentage: percentage(line.freeThrowsMade, line.freeThrowsAttempted),
      reboundsTotal: line.reboundsOffensive + line.reboundsDefensive,
    };
    return {
      personId: player.id,
      firstName: player.first,
      familyName: player.last,
      nameI: `${player.first[0]}. ${player.last}`,
      playerSlug: `${player.first}-${player.last}`.toLowerCase(),
      position: player.starter ? player.position : "",
      comment: didPlay ? "" : "DNP - Coach's Decision",
      jerseyNum: player.number,
      statistics,
    };
  });
  const totals = Object.fromEntries(STAT_KEYS.map((key) => [key, players.reduce((sum, p) => sum + p.statistics[key], 0)]));
  // Plus-minus for a team is the margin; players' plus-minus sums to 5 times it.
  totals.plusMinusPoints = Math.round(totals.plusMinusPoints / 5);
  totals.reboundsTotal = totals.reboundsOffensive + totals.reboundsDefensive;
  totals.fieldGoalsPercentage = percentage(totals.fieldGoalsMade, totals.fieldGoalsAttempted);
  totals.threePointersPercentage = percentage(totals.threePointersMade, totals.threePointersAttempted);
  totals.freeThrowsPercentage = percentage(totals.freeThrowsMade, totals.freeThrowsAttempted);
  totals.minutes = `${(48 + (played.periodScores.home.length - 4) * 5) * 5}:00`;
  return {
    teamId: team.id,
    teamCity: team.city,
    teamName: team.nickname,
    teamTricode: team.abbreviation,
    teamSlug: team.nickname.toLowerCase(),
    players,
    statistics: totals,
  };
}

// The games' date as the game logs write it: "OCT 21, 2025".
function gameLogDate(date) {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const [year, month, day] = date.split("-").map(Number);
  return `${months[month - 1]} ${day}, ${year}`;
}

// A stats.nba.com result set: { name, headers, rowSet }.
function resultSet(name, headers, rows) {
  return { name, headers, rowSet: rows.map((row) => headers.map((h) => row[h])) };
}

const SHOT_HEADERS = [
  "GRID_TYPE", "GAME_ID", "GAME_EVENT_ID", "PLAYER_ID", "PLAYER_NAME", "TEAM_ID", "TEAM_NAME",
  "PERIOD", "MINUTES_REMAINING", "SECONDS_REMAINING", "EVENT_TYPE", "ACTION_TYPE", "SHOT_TYPE",
  "SHOT_ZONE_BASIC", "SHOT_ZONE_AREA", "SHOT_ZONE_RANGE", "SHOT_DISTANCE", "LOC_X", "LOC_Y",
  "SHOT_ATTEMPTED_FLAG", "SHOT_MADE_FLAG", "GAME_DATE", "HTM", "VTM",
];
const LEAGUE_HEADERS = ["GRID_TYPE", "SHOT_ZONE_BASIC", "SHOT_ZONE_AREA", "SHOT_ZONE_RANGE", "FGA", "FGM", "FG_PCT"];
const GAME_LOG_HEADERS = ["Team_ID", "Game_ID", "GAME_DATE", "MATCHUP", "WL"];

// Teams named for a region rather than a city, and the city they play in.
const HOME_CITIES = {
  GSW: "San Francisco",
  IND: "Indianapolis",
  MIN: "Minneapolis",
  UTA: "Salt Lake City",
};

// Real arena names for the teams whose floors the app draws differently, so
// those floors show in the fake games too.
const REAL_ARENAS = {
  BOS: "TD Garden",
  BKN: "Barclays Center",
  ORL: "Kia Center",
};

// Careers for the fake players: playercareerstats, and a shot chart for
// each season, as stats.nba.com sends them.

const CAREER_STAT_HEADERS = [
  "GP", "GS", "MIN", "FGM", "FGA", "FG_PCT", "FG3M", "FG3A", "FG3_PCT", "FTM", "FTA", "FT_PCT",
  "OREB", "DREB", "REB", "AST", "STL", "BLK", "TOV", "PF", "PTS",
];
const CAREER_SEASON_HEADERS = [
  "PLAYER_ID", "SEASON_ID", "LEAGUE_ID", "TEAM_ID", "TEAM_ABBREVIATION", "PLAYER_AGE", ...CAREER_STAT_HEADERS,
];
const CAREER_TOTAL_HEADERS = ["PLAYER_ID", "LEAGUE_ID", "Team_ID", ...CAREER_STAT_HEADERS];

// A player's season shot chart only needs to say where each shot was and if
// it went in, so it leaves out the rest of a game shot chart's columns.
const PLAYER_SHOT_HEADERS = [
  "GRID_TYPE", "PLAYER_ID", "TEAM_ID", "SHOT_ZONE_BASIC", "SHOT_ZONE_AREA", "SHOT_ZONE_RANGE",
  "SHOT_DISTANCE", "LOC_X", "LOC_Y", "SHOT_MADE_FLAG",
];

// How many seasons a player may have had before the simulated one.
const MAX_PAST_SEASONS = 4;

function seasonLabel(season) {
  return `${season}-${String(season + 1).slice(2)}`;
}

// Box score totals as the career columns name them.
function careerStats(t) {
  return {
    GP: t.gp,
    GS: t.gs,
    MIN: Math.round(t.min),
    FGM: t.fgm,
    FGA: t.fga,
    FG_PCT: percentage(t.fgm, t.fga),
    FG3M: t.fg3m,
    FG3A: t.fg3a,
    FG3_PCT: percentage(t.fg3m, t.fg3a),
    FTM: t.ftm,
    FTA: t.fta,
    FT_PCT: percentage(t.ftm, t.fta),
    OREB: t.oreb,
    DREB: t.dreb,
    REB: t.oreb + t.dreb,
    AST: t.ast,
    STL: t.stl,
    BLK: t.blk,
    TOV: t.tov,
    PF: t.pf,
    PTS: 2 * (t.fgm - t.fg3m) + 3 * t.fg3m + t.ftm,
  };
}

function shotTotals(totals, shots) {
  totals.fga += shots.length;
  for (const shot of shots) {
    totals.fgm += shot.made ? 1 : 0;
    totals.fg3a += shot.isThree ? 1 : 0;
    totals.fg3m += shot.isThree && shot.made ? 1 : 0;
  }
}

function emptyTotals() {
  return { gp: 0, gs: 0, min: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0 };
}

// The simulated season, from the player's games.
function playedSeason(player, games) {
  const totals = emptyTotals();
  const shots = [];
  for (const { played } of games) {
    const line = played.lines.get(player.id);
    if (!line || !(played.minutesTonight.get(player.id) > 0)) {
      continue;
    }
    totals.gp++;
    totals.gs += player.starter ? 1 : 0;
    totals.min += line.seconds / 60;
    totals.ftm += line.freeThrowsMade;
    totals.fta += line.freeThrowsAttempted;
    totals.oreb += line.reboundsOffensive;
    totals.dreb += line.reboundsDefensive;
    totals.ast += line.assists;
    totals.stl += line.steals;
    totals.blk += line.blocks;
    totals.tov += line.turnovers;
    totals.pf += line.foulsPersonal;
    shots.push(...played.shots.filter((shot) => shot.shooter === player));
  }
  shotTotals(totals, shots);
  return { totals, shots };
}

// An earlier season `yearsBack` before the simulated one, made from the
// player's profile: younger players play a little less, and their touch
// drifts from year to year.
function pastSeason(player, yearsBack, tools) {
  const { between, int, chance } = tools;
  let usualMinutes = player.minutes;
  if (usualMinutes === 0) {
    usualMinutes = between(6, 14);
  }
  const perGame = Math.max(4, Math.min(38, usualMinutes + between(-6, 4) - yearsBack * 1.5));
  const totals = emptyTotals();
  totals.gp = int(35, 82);
  totals.min = totals.gp * perGame;
  if (player.starter) {
    totals.gs = int(Math.round(totals.gp * 0.6), totals.gp);
  } else {
    totals.gs = int(0, Math.round(totals.gp * 0.15));
  }

  const drift = between(-0.03, 0.03) - yearsBack * 0.005;
  const shots = Array.from({ length: Math.round(totals.min * (0.22 + 0.1 * player.usage)) }, () => takeShot(player, tools, drift));
  shotTotals(totals, shots);

  totals.fta = Math.round(totals.fga * between(0.15, 0.35));
  const freeThrow = Math.max(0.4, Math.min(0.95, player.freeThrow + between(-0.04, 0.04)));
  for (let i = 0; i < totals.fta; i++) {
    totals.ftm += chance(freeThrow) ? 1 : 0;
  }
  // Per-minute rates by the player's strengths.
  const rebounds = Math.round(totals.min * 0.1 * player.rebounding);
  totals.oreb = Math.round(rebounds * 0.25);
  totals.dreb = rebounds - totals.oreb;
  totals.ast = Math.round(totals.min * 0.07 * player.passing);
  totals.stl = Math.round(totals.min * 0.03 * player.defense);
  totals.blk = Math.round(totals.min * 0.01 * player.rebounding);
  totals.tov = Math.round(totals.min * 0.04 * player.usage);
  totals.pf = Math.round(totals.min * 0.065);
  return { totals, shots };
}

function playerShotChart(player, team, shots, leagueAverages) {
  const rows = shots.map((shot) => {
    const [basic, area] = shot.zone.split("|");
    return {
      GRID_TYPE: "Shot Chart Detail",
      PLAYER_ID: player.id,
      TEAM_ID: team.id,
      SHOT_ZONE_BASIC: basic,
      SHOT_ZONE_AREA: area,
      SHOT_ZONE_RANGE: zoneRange(shot.feet, shot.isThree),
      SHOT_DISTANCE: shot.feet,
      LOC_X: shot.x,
      LOC_Y: shot.y,
      SHOT_MADE_FLAG: shot.made ? 1 : 0,
    };
  });
  return {
    resultSets: [
      resultSet("Shot_Chart_Detail", PLAYER_SHOT_HEADERS, rows),
      resultSet("LeagueAverages", LEAGUE_HEADERS, leagueAverages),
    ],
  };
}

// Each player's career: a few earlier seasons, then the simulated one.
// Returns Map(player id -> { career, shotCharts: Map(season -> json) }).
// Earlier seasons share the simulated season's league averages.
function fakeCareers({ season, teams, rosters, games, leagueAverages, tools }) {
  const players = new Map();
  for (const team of teams) {
    for (const player of rosters.get(team.id)) {
      const current = playedSeason(player, games);
      let pastCount = tools.int(0, MAX_PAST_SEASONS);
      // Everyone has at least one season to show.
      if (current.totals.gp === 0 && pastCount === 0) {
        pastCount = 1;
      }
      const age = 21 + pastCount + tools.int(0, 4);

      const seasons = [];
      for (let yearsBack = pastCount; yearsBack >= 1; yearsBack--) {
        let seasonTeam = team;
        if (!tools.chance(0.75)) {
          seasonTeam = tools.pick(teams.filter((t) => t !== team));
        }
        seasons.push({ season: season - yearsBack, team: seasonTeam, age: age - yearsBack, ...pastSeason(player, yearsBack, tools) });
      }
      if (current.totals.gp > 0) {
        seasons.push({ season, team, age, ...current });
      }

      const total = emptyTotals();
      for (const { totals } of seasons) {
        for (const key of Object.keys(total)) {
          total[key] += totals[key];
        }
      }
      const seasonRows = seasons.map((s) => ({
        PLAYER_ID: player.id,
        SEASON_ID: seasonLabel(s.season),
        LEAGUE_ID: "00",
        TEAM_ID: s.team.id,
        TEAM_ABBREVIATION: s.team.abbreviation,
        PLAYER_AGE: s.age,
        ...careerStats(s.totals),
      }));
      const career = {
        resultSets: [
          resultSet("SeasonTotalsRegularSeason", CAREER_SEASON_HEADERS, seasonRows),
          resultSet("CareerTotalsRegularSeason", CAREER_TOTAL_HEADERS, [
            { PLAYER_ID: player.id, LEAGUE_ID: "00", Team_ID: 0, ...careerStats(total) },
          ]),
        ],
      };
      const shotCharts = new Map(seasons.map((s) => [s.season, playerShotChart(player, s.team, s.shots, leagueAverages)]));
      players.set(player.id, { career, shotCharts });
    }
  }
  return players;
}

const TEAM_STAT_HEADERS = [
  "TEAM_ID", "TEAM_NAME", "GP", "MIN", "FGM", "FGA", "FG3M", "FG3A", "FTM", "FTA",
  "OREB", "DREB", "REB", "AST", "TOV", "STL", "BLK", "PF", "PTS",
];

// The league's team stats (leaguedashteamstats) for every season a fake
// career covers, all the simulated season's: earlier seasons have no games
// of their own. Returns Map(season -> json).
function fakeLeague(season, teams, byGame) {
  const rows = new Map(teams.map((team) => [team.id, {
    ...Object.fromEntries(TEAM_STAT_HEADERS.map((header) => [header, 0])),
    TEAM_ID: team.id,
    TEAM_NAME: team.full_name,
  }]));
  for (const game of byGame.values()) {
    const box = game.boxscoretraditionalv3.boxScoreTraditional;
    for (const team of [box.homeTeam, box.awayTeam]) {
      const row = rows.get(team.teamId);
      const stats = team.statistics;
      row.GP++;
      // The box score counts its players' minutes; a team's are a fifth.
      row.MIN += Number(stats.minutes.split(":")[0]) / 5;
      row.FGM += stats.fieldGoalsMade;
      row.FGA += stats.fieldGoalsAttempted;
      row.FG3M += stats.threePointersMade;
      row.FG3A += stats.threePointersAttempted;
      row.FTM += stats.freeThrowsMade;
      row.FTA += stats.freeThrowsAttempted;
      row.OREB += stats.reboundsOffensive;
      row.DREB += stats.reboundsDefensive;
      row.REB += stats.reboundsTotal;
      row.AST += stats.assists;
      row.TOV += stats.turnovers;
      row.STL += stats.steals;
      row.BLK += stats.blocks;
      row.PF += stats.foulsPersonal;
      row.PTS += stats.points;
    }
  }
  const json = { resultSets: [resultSet("LeagueDashTeamStats", TEAM_STAT_HEADERS, [...rows.values()])] };
  return new Map(Array.from({ length: MAX_PAST_SEASONS + 1 }, (_, i) => [season - i, json]));
}

// A season of fake games: `gamesPerTeam` for every team, from opening night
// of `season` (the year it starts). Returns the stats.nba.com responses by
// endpoint: game logs by team id, each game's summary, box score,
// play-by-play, and shot chart by game id, each player's career and season
// shot charts by player id (see fakeCareers), and the league's team stats
// by season (see fakeLeague).
export function fakeSeason({ season, gamesPerTeam = 10, seed = 1 }) {
  const tools = makeTools(seededRandom(seed));
  const teams = getTeams();
  const usedNames = new Set();
  const rosters = new Map(teams.map((team, i) => [team.id, makeRoster(team, i, tools, usedNames)]));
  const yy = String(season).slice(2);
  const schedule = makeSchedule(teams, gamesPerTeam, season, tools).map((game, i) => ({
    ...game,
    // Fake games are numbered from 9001, past any real season's.
    id: `002${yy}${String(9001 + i).padStart(5, "0")}`,
  }));

  const games = schedule.map((game) => ({ ...game, played: simulateGame(game, rosters, tools) }));

  // The league's shooting by zone and distance, from every fake shot.
  const league = new Map();
  for (const { played } of games) {
    for (const shot of played.shots) {
      const key = `${shot.zone}|${zoneRange(shot.feet, shot.isThree)}`;
      const totals = league.get(key) ?? { fga: 0, fgm: 0 };
      totals.fga++;
      totals.fgm += shot.made ? 1 : 0;
      league.set(key, totals);
    }
  }
  const leagueAverages = [...league].map(([key, { fga, fgm }]) => {
    const [basic, area, range] = key.split("|");
    return {
      GRID_TYPE: "League Averages",
      SHOT_ZONE_BASIC: basic,
      SHOT_ZONE_AREA: area,
      SHOT_ZONE_RANGE: range,
      FGA: fga,
      FGM: fgm,
      FG_PCT: percentage(fgm, fga),
    };
  });

  const responses = { teamgamelog: new Map(), byGame: new Map() };
  for (const team of teams) {
    const rows = games
      .filter((g) => g.home.id === team.id || g.away.id === team.id)
      .reverse()
      .map((g) => {
        const home = g.home.id === team.id;
        const own = home ? g.played.score.home : g.played.score.away;
        const theirs = home ? g.played.score.away : g.played.score.home;
        return {
          Team_ID: team.id,
          Game_ID: g.id,
          GAME_DATE: gameLogDate(g.date),
          MATCHUP: home ? `${team.abbreviation} vs. ${g.away.abbreviation}` : `${team.abbreviation} @ ${g.home.abbreviation}`,
          WL: own > theirs ? "W" : "L",
        };
      });
    responses.teamgamelog.set(team.id, { resultSets: [resultSet("TeamGameLog", GAME_LOG_HEADERS, rows)] });
  }

  for (const g of games) {
    const { played } = g;
    const periods = played.periodScores.home.length;
    const summaryTeam = (team, side) => ({
      teamId: team.id,
      teamCity: team.city,
      teamName: team.nickname,
      teamTricode: team.abbreviation,
      teamSlug: team.nickname.toLowerCase(),
      teamWins: 0,
      teamLosses: 0,
      score: played.score[side],
      periods: played.periodScores[side].map((score, i) => ({ period: i + 1, periodType: i < 4 ? "REGULAR" : "OVERTIME", score })),
    });
    let status = "Final";
    if (periods > 4) {
      status = periods === 5 ? "Final/OT" : `Final/${periods - 4}OT`;
    }
    const attendance = tools.int(15_000, 21_000);
    // Venues are made up too, except those with their own floors, so the
    // floors show.
    const city = HOME_CITIES[g.home.abbreviation] ?? g.home.city;
    const arenaName = REAL_ARENAS[g.home.abbreviation] ?? `${city} Arena`;
    const summary = {
      boxScoreSummary: {
        gameId: g.id,
        gameCode: `${g.date.replaceAll("-", "")}/${g.away.abbreviation}${g.home.abbreviation}`,
        gameStatus: 3,
        gameStatusText: status,
        period: periods,
        gameClock: "",
        gameTimeUTC: `${g.date}T23:30:00Z`,
        gameEt: `${g.date}T19:30:00Z`,
        awayTeamId: g.away.id,
        homeTeamId: g.home.id,
        duration: 130 + periods * 10,
        attendance,
        sellout: attendance > 20_000 ? 1 : 0,
        arena: { arenaName, arenaCity: city, arenaState: "", arenaCountry: "US" },
        homeTeam: summaryTeam(g.home, "home"),
        awayTeam: summaryTeam(g.away, "away"),
      },
    };

    const boxScore = {
      boxScoreTraditional: {
        gameId: g.id,
        homeTeamId: g.home.id,
        awayTeamId: g.away.id,
        homeTeam: boxScoreTeam(g.home, rosters.get(g.home.id), played),
        awayTeam: boxScoreTeam(g.away, rosters.get(g.away.id), played),
      },
    };

    const playByPlay = { game: { gameId: g.id, videoAvailable: 0, actions: played.actions } };

    const shotRows = played.shots.map((shot) => {
      const team = shot.side === "home" ? g.home : g.away;
      const [basic, area] = shot.zone.split("|");
      const seconds = Math.floor(shot.clock);
      return {
        GRID_TYPE: "Shot Chart Detail",
        GAME_ID: g.id,
        GAME_EVENT_ID: shot.actionNumber,
        PLAYER_ID: shot.shooter.id,
        PLAYER_NAME: `${shot.shooter.first} ${shot.shooter.last}`,
        TEAM_ID: team.id,
        TEAM_NAME: team.full_name,
        PERIOD: shot.period,
        MINUTES_REMAINING: Math.floor(seconds / 60),
        SECONDS_REMAINING: seconds % 60,
        EVENT_TYPE: shot.made ? "Made Shot" : "Missed Shot",
        ACTION_TYPE: shot.action,
        SHOT_TYPE: shot.isThree ? "3PT Field Goal" : "2PT Field Goal",
        SHOT_ZONE_BASIC: basic,
        SHOT_ZONE_AREA: area,
        SHOT_ZONE_RANGE: zoneRange(shot.feet, shot.isThree),
        SHOT_DISTANCE: shot.feet,
        LOC_X: shot.x,
        LOC_Y: shot.y,
        SHOT_ATTEMPTED_FLAG: 1,
        SHOT_MADE_FLAG: shot.made ? 1 : 0,
        GAME_DATE: g.date.replaceAll("-", ""),
        HTM: g.home.abbreviation,
        VTM: g.away.abbreviation,
      };
    });
    const shotChart = {
      resultSets: [
        resultSet("Shot_Chart_Detail", SHOT_HEADERS, shotRows),
        resultSet("LeagueAverages", LEAGUE_HEADERS, leagueAverages),
      ],
    };

    responses.byGame.set(g.id, {
      date: g.date,
      home: g.home.abbreviation,
      away: g.away.abbreviation,
      score: played.score,
      boxscoresummaryv3: summary,
      boxscoretraditionalv3: boxScore,
      playbyplayv3: playByPlay,
      shotchartdetail: shotChart,
    });
  }
  responses.league = fakeLeague(season, teams, responses.byGame);
  responses.players = fakeCareers({ season, teams, rosters, games, leagueAverages, tools });
  return responses;
}
