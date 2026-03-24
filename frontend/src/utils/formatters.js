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
export const getTeamAbbr = (teamId) => (Number(teamId) === 136 ? "SEA" : "ATL");

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

/** Get game status label */
export const getGameLabel = (game) => {
  if (!game || game.noGame) return "";
  if (game.status === "In Progress") return "LIVE";
  if (game.status === "Final") return "FINAL";
  if (game.isNextGame) return "NEXT GAME";
  return isToday(game.gameDate) ? "TODAY" : "NEXT GAME";
};
