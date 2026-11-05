// Every five-man unit each team played in a game, how long it played, and
// what it outscored the other team by, worked out from stats.nba.com's
// play-by-play and box score.
//
// The play-by-play records each substitution as one action: its personId is
// the player coming out, and the one going in is only named, by last name,
// in the description ("SUB: Pritchard FOR Hauser"). Changes between quarters
// aren't recorded at all, so each quarter's opening five is worked out from
// who shows up in it before being subbed in.

const PERIOD_SECONDS = 720;
const OVERTIME_SECONDS = 300;

function periodLength(period) {
  if (period <= 4) {
    return PERIOD_SECONDS;
  }
  return OVERTIME_SECONDS;
}

// Seconds into the period, from a clock like "PT11M42.50S" (time left).
function elapsed(action) {
  const match = /PT(\d+)M([\d.]+)S/.exec(action.clock ?? "");
  if (!match) {
    return null;
  }
  return periodLength(action.period) - (Number(match[1]) * 60 + Number(match[2]));
}

const SUBSTITUTION = /^SUB: (.+) FOR (.+)$/;

// The ways a name can be spelled in the box score and the descriptions,
// which don't always agree: in any case, without a suffix ("Butler" for
// "Butler III", "Boston Jr." for "Boston"), and with accents dropped
// ("Vucevic" for "Vučević") or umlauts written out ("Poeltl" for "Pöltl").
function spellings(name) {
  const base = (name ?? "").toLowerCase().replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/, "").trim();
  const dropped = base.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const written = base.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return new Set([dropped, written]);
}

function sameName(a, b) {
  const forms = spellings(b);
  return [...spellings(a)].some((form) => forms.has(form));
}

// The player a substitution sends in, from the name in its description:
// a teammate with that last name ("Pritchard"), or when two share one, the
// start of the first name too ("T. Johnson", or "Jal. Williams" beside
// "Jay. Williams"), preferring one who isn't already on the floor. Null
// when no one on the roster matches.
function playerGoingIn(action, roster, onFloor) {
  const name = SUBSTITUTION.exec(action.description ?? "")?.[1]?.trim();
  if (!name) {
    return null;
  }
  const initial = /^(\p{L}+)\. (.+)$/u.exec(name);
  const named = (same) => roster.filter((p) => {
    if (initial) {
      return same(p.familyName, initial[2]) && [...spellings(p.firstName)].some((first) => first.startsWith(initial[1].toLowerCase()));
    }
    return same(p.familyName, name);
  });
  // The name as written first, so "Smith" isn't taken for a teammate
  // "Smith Jr."; then the other spellings.
  let matches = named((a, b) => a.toLowerCase() === b.toLowerCase());
  if (matches.length === 0) {
    matches = named(sameName);
  }
  // A name given family name first, like Yang Hansen's: the box score has
  // "Yang" as his family name, and the descriptions call him "Hansen".
  if (matches.length === 0) {
    matches = roster.filter((p) => sameName(p.firstName, name));
  }
  return (matches.find((p) => !onFloor.has(p.personId)) ?? matches[0])?.personId ?? null;
}

// A team's five at the start of a period. The first quarter's are the box
// score's starters. Otherwise: everyone who shows up in the period before a
// substitution sends them in (including those subbed out first), then, if
// someone played the period without being in any play, whoever ended the
// last period and wasn't subbed in, then whoever played the most minutes.
function openingFive(period, actions, roster, previous) {
  const starters = roster.filter((p) => p.position).map((p) => p.personId);
  if (period === 1 && starters.length === 5) {
    return new Set(starters);
  }

  const ids = new Set(roster.map((p) => p.personId));
  const five = new Set();
  const cameIn = new Set();
  for (const action of actions) {
    if (five.size === 5) {
      break;
    }
    if (!ids.has(action.personId)) {
      continue;
    }
    if (!cameIn.has(action.personId)) {
      five.add(action.personId);
    }
    if (action.actionType === "Substitution") {
      const into = playerGoingIn(action, roster, five);
      if (into != null && !five.has(into)) {
        cameIn.add(into);
      }
    }
  }
  const byMinutes = [...roster].sort((a, b) => minutesOf(b) - minutesOf(a)).map((p) => p.personId);
  for (const id of [...previous, ...byMinutes]) {
    if (five.size === 5) {
      break;
    }
    if (!cameIn.has(id)) {
      five.add(id);
    }
  }
  return five;
}

function minutesOf(player) {
  const [minutes = 0, seconds = 0] = String(player.minutes ?? "").split(":").map(Number);
  return minutes * 60 + seconds;
}

// { [teamId]: [{ players: [ids], seconds, pts_for, pts_against }] } for a
// game, each team's lineups by time on the floor, longest first. `actions`
// are playbyplayv3's, in order; `players` the box score's (PlayerStats).
// Substitutions whose incoming player can't be named are skipped and
// counted in `unmatched`.
export function gameLineups(actions, players) {
  const { homeTeamId, awayTeamId } = players[0] ?? {};
  const rosters = new Map([homeTeamId, awayTeamId].map((id) => [id, players.filter((p) => p.teamId === id)]));
  const units = new Map([homeTeamId, awayTeamId].map((id) => [id, new Map()]));
  const onFloor = new Map([homeTeamId, awayTeamId].map((id) => [id, new Set()]));
  let unmatched = 0;

  const credit = (seconds, points) => {
    for (const [teamId, five] of onFloor) {
      if (five.size === 0) {
        continue;
      }
      const key = [...five].sort((a, b) => a - b).join(",");
      const unit = units.get(teamId).get(key) ?? { players: key.split(",").map(Number), seconds: 0, pts_for: 0, pts_against: 0 };
      unit.seconds += seconds;
      if (teamId === homeTeamId) {
        unit.pts_for += points.home;
        unit.pts_against += points.away;
      } else {
        unit.pts_for += points.away;
        unit.pts_against += points.home;
      }
      units.get(teamId).set(key, unit);
    }
  };

  // Substitutions during free throws take effect after them: the NBA's
  // plus-minus credits free throws to the players on the floor when the
  // foul was called, not to anyone who came in between shots. Among actions
  // at the same moment, substitutions go last.
  actions = actions.map((action, i) => ({ action, i }))
    .sort((a, b) => {
      const same = a.action.period === b.action.period && a.action.clock === b.action.clock;
      if (!same) {
        return a.i - b.i;
      }
      const subA = a.action.actionType === "Substitution" ? 1 : 0;
      const subB = b.action.actionType === "Substitution" ? 1 : 0;
      return subA - subB || a.i - b.i;
    })
    .map(({ action }) => action);

  const periods = [...new Set(actions.map((a) => a.period))].filter((p) => p > 0).sort((a, b) => a - b);
  let score = { home: 0, away: 0 };
  for (const period of periods) {
    const inPeriod = actions.filter((a) => a.period === period);
    for (const [teamId, roster] of rosters) {
      onFloor.set(teamId, openingFive(period, inPeriod, roster, onFloor.get(teamId)));
    }
    let at = 0;
    for (const action of inPeriod) {
      const t = elapsed(action);
      if (t != null && t > at) {
        credit(t - at, { home: 0, away: 0 });
        at = t;
      }
      const home = Number.parseInt(action.scoreHome, 10);
      const away = Number.parseInt(action.scoreAway, 10);
      if (Number.isFinite(home) && Number.isFinite(away) && home >= score.home && away >= score.away
        && home + away > score.home + score.away) {
        credit(0, { home: home - score.home, away: away - score.away });
        score = { home, away };
      }
      if (action.actionType === "Substitution" && rosters.has(action.teamId)) {
        const five = onFloor.get(action.teamId);
        const into = playerGoingIn(action, rosters.get(action.teamId), five);
        if (into == null || !five.has(action.personId)) {
          unmatched++;
          continue;
        }
        five.delete(action.personId);
        five.add(into);
      }
    }
    credit(periodLength(period) - at, { home: 0, away: 0 });
  }

  const result = { unmatched };
  for (const [teamId, teamUnits] of units) {
    result[teamId] = [...teamUnits.values()]
      .filter((unit) => unit.seconds > 0 || unit.pts_for || unit.pts_against)
      .sort((a, b) => b.seconds - a.seconds);
  }
  return result;
}
