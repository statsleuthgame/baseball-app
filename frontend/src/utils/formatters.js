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
