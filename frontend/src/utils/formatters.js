export function formatAvg(val) {
  if (val == null) return "—";
  const num = typeof val === "string" ? parseFloat(val) : val;
  return num.toFixed(3).replace(/^0/, "");
}

export function formatEra(val) {
  if (val == null) return "—";
  const num = typeof val === "string" ? parseFloat(val) : val;
  return num.toFixed(2);
}

export function formatPct(val) {
  if (val == null) return "—";
  const num = typeof val === "string" ? parseFloat(val) : val;
  return `${(num * 100).toFixed(1)}%`;
}

export function formatGameDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function formatGameTime(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** @param {number|string} teamId */
export const getTeamAbbr = (teamId) => {
  // Dynamic lookup — import would create circular dep, so inline the essentials
  const ABBRS = {
    109:"AZ",110:"BAL",111:"BOS",112:"CHC",113:"CIN",114:"CLE",115:"COL",116:"DET",
    117:"HOU",118:"KC",119:"LAD",120:"WSH",121:"NYM",108:"LAA",133:"ATH",134:"PIT",
    135:"SD",136:"SEA",137:"SF",138:"STL",139:"TB",140:"TEX",141:"TOR",142:"MIN",
    143:"PHI",144:"ATL",145:"CWS",146:"MIA",147:"NYY",158:"MIL",
  };
  return ABBRS[Number(teamId)] || "MLB";
};

/** Get display name for box score headers (city name, except NY/LA teams use nickname) */
export const teamDisplayName = (abbr) => {
  const NAMES = {
    AZ:"Arizona", ATL:"Atlanta", BAL:"Baltimore", BOS:"Boston",
    CHC:"Chicago", CWS:"Chicago", CIN:"Cincinnati", CLE:"Cleveland",
    COL:"Colorado", DET:"Detroit", HOU:"Houston", KC:"Kansas City",
    LAA:"Angels", LAD:"Dodgers", MIA:"Miami", MIL:"Milwaukee",
    MIN:"Minnesota", NYM:"Mets", NYY:"Yankees", ATH:"Oakland",
    PHI:"Philadelphia", PIT:"Pittsburgh", SD:"San Diego",
    SF:"San Francisco", SEA:"Seattle", STL:"St. Louis",
    TB:"Tampa Bay", TEX:"Texas", TOR:"Toronto", WSH:"Washington",
  };
  return NAMES[abbr] || abbr;
};

/** Check if a date is today */
export const isToday = (isoDate) => {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};

/** Rounding helpers */
export const round1 = (n) => Math.round(n * 10) / 10;
export const round3 = (n) => Math.round(n * 1000) / 1000;

/** First initial + last name (e.g. "Logan Gilbert" → "L. Gilbert") */
export const shortName = (fullName) => {
  if (!fullName) return "";
  const parts = fullName.split(" ");
  if (parts.length <= 1) return fullName;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
};

/** Get last name, preserving suffixes like Jr., Sr., II, III, IV */
export const lastName = (fullName) => {
  if (!fullName) return "";
  const parts = fullName.split(" ");
  if (parts.length <= 1) return fullName;
  return parts.slice(1).join(" ");
};

/** Get game status label */
export const getGameLabel = (game) => {
  if (!game || game.noGame) return "";
  if (game.status === "In Progress") return "LIVE";
  if (game.status === "Final") return "FINAL";
  if (game.isNextGame) return "NEXT GAME";
  return isToday(game.gameDate) ? "TODAY" : "NEXT GAME";
};
