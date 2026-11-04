// Team uniform colors, keyed by NBA team id. stats.nba.com doesn't publish
// these; they were copied from ESPN's public teams endpoint
// (https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams) on 2026-10-31.
const COLORS = {
  1610612737: { primary: "#c8102e", secondary: "#fdb927" }, // ATL
  1610612738: { primary: "#008348", secondary: "#ffffff" }, // BOS
  1610612739: { primary: "#860038", secondary: "#bc945c" }, // CLE
  1610612740: { primary: "#0a2240", secondary: "#b4975a" }, // NOP
  1610612741: { primary: "#ce1141", secondary: "#000000" }, // CHI
  1610612742: { primary: "#0064b1", secondary: "#bbc4ca" }, // DAL
  1610612743: { primary: "#0e2240", secondary: "#fec524" }, // DEN
  1610612744: { primary: "#fdb927", secondary: "#1d428a" }, // GSW
  1610612745: { primary: "#ce0e2d", secondary: "#000000" }, // HOU
  1610612746: { primary: "#12173f", secondary: "#c8102e" }, // LAC
  1610612747: { primary: "#552583", secondary: "#fdb927" }, // LAL
  1610612748: { primary: "#98002e", secondary: "#000000" }, // MIA
  1610612749: { primary: "#00471b", secondary: "#eee1c6" }, // MIL
  1610612750: { primary: "#266092", secondary: "#79bc43" }, // MIN
  1610612751: { primary: "#000000", secondary: "#ffffff" }, // BKN
  1610612752: { primary: "#1d428a", secondary: "#f58426" }, // NYK
  1610612753: { primary: "#0150b5", secondary: "#9ca0a3" }, // ORL
  1610612754: { primary: "#0c2340", secondary: "#ffd520" }, // IND
  1610612755: { primary: "#1d428a", secondary: "#e01234" }, // PHI
  1610612756: { primary: "#29127a", secondary: "#e56020" }, // PHX
  1610612757: { primary: "#e03a3e", secondary: "#000000" }, // POR
  1610612758: { primary: "#5a2d81", secondary: "#6a7a82" }, // SAC
  1610612759: { primary: "#000000", secondary: "#c4ced4" }, // SAS
  1610612760: { primary: "#007ac1", secondary: "#ef3b24" }, // OKC
  1610612761: { primary: "#d91244", secondary: "#000000" }, // TOR
  1610612762: { primary: "#4e008e", secondary: "#79a3dc" }, // UTA
  1610612763: { primary: "#5d76a9", secondary: "#12173f" }, // MEM
  1610612764: { primary: "#e31837", secondary: "#002b5c" }, // WAS
  1610612765: { primary: "#1d428a", secondary: "#c8102e" }, // DET
  1610612766: { primary: "#008ca8", secondary: "#1d1060" }, // CHA
};

export function teamColors(teamId) {
  return COLORS[teamId] ?? null;
}
