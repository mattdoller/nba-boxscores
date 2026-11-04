// Port of nba_api/stats/static/teams.py, limited to the 30 current franchises.

// From nba_api's static data: [id, abbreviation, nickname, city, full name].
export const teams = [
  [1610612737, "ATL", "Hawks", "Atlanta", "Atlanta Hawks"],
  [1610612738, "BOS", "Celtics", "Boston", "Boston Celtics"],
  [1610612739, "CLE", "Cavaliers", "Cleveland", "Cleveland Cavaliers"],
  [1610612740, "NOP", "Pelicans", "New Orleans", "New Orleans Pelicans"],
  [1610612741, "CHI", "Bulls", "Chicago", "Chicago Bulls"],
  [1610612742, "DAL", "Mavericks", "Dallas", "Dallas Mavericks"],
  [1610612743, "DEN", "Nuggets", "Denver", "Denver Nuggets"],
  [1610612744, "GSW", "Warriors", "Golden State", "Golden State Warriors"],
  [1610612745, "HOU", "Rockets", "Houston", "Houston Rockets"],
  [1610612746, "LAC", "Clippers", "Los Angeles", "Los Angeles Clippers"],
  [1610612747, "LAL", "Lakers", "Los Angeles", "Los Angeles Lakers"],
  [1610612748, "MIA", "Heat", "Miami", "Miami Heat"],
  [1610612749, "MIL", "Bucks", "Milwaukee", "Milwaukee Bucks"],
  [1610612750, "MIN", "Timberwolves", "Minnesota", "Minnesota Timberwolves"],
  [1610612751, "BKN", "Nets", "Brooklyn", "Brooklyn Nets"],
  [1610612752, "NYK", "Knicks", "New York", "New York Knicks"],
  [1610612753, "ORL", "Magic", "Orlando", "Orlando Magic"],
  [1610612754, "IND", "Pacers", "Indiana", "Indiana Pacers"],
  [1610612755, "PHI", "76ers", "Philadelphia", "Philadelphia 76ers"],
  [1610612756, "PHX", "Suns", "Phoenix", "Phoenix Suns"],
  [1610612757, "POR", "Trail Blazers", "Portland", "Portland Trail Blazers"],
  [1610612758, "SAC", "Kings", "Sacramento", "Sacramento Kings"],
  [1610612759, "SAS", "Spurs", "San Antonio", "San Antonio Spurs"],
  [1610612760, "OKC", "Thunder", "Oklahoma City", "Oklahoma City Thunder"],
  [1610612761, "TOR", "Raptors", "Toronto", "Toronto Raptors"],
  [1610612762, "UTA", "Jazz", "Utah", "Utah Jazz"],
  [1610612763, "MEM", "Grizzlies", "Memphis", "Memphis Grizzlies"],
  [1610612764, "WAS", "Wizards", "Washington", "Washington Wizards"],
  [1610612765, "DET", "Pistons", "Detroit", "Detroit Pistons"],
  [1610612766, "CHA", "Hornets", "Charlotte", "Charlotte Hornets"],
].map(([id, abbreviation, nickname, city, full_name]) => ({ id, abbreviation, nickname, city, full_name }));

export function getTeams() {
  return teams;
}

export function findTeamById(id) {
  return teams.find((t) => t.id === Number(id));
}
