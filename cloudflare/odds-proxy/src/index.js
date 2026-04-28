// On-demand pregame moneyline proxy for the Baseball App scoreboard.
// Holds the The Odds API key as a Cloudflare Worker secret so the
// browser never sees it. Returns median American-odds across US books
// for every MLB game whose local-ET commence date matches ?date=YYYY-MM-DD.
//
// CORS: open to any origin. The endpoint only proxies a public,
// read-only odds API — no auth, no PII, no mutating operations — so
// origin-locking adds no meaningful security and only causes failures
// on corporate networks that strip the Origin header.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (req.method !== "GET") {
      return json({ error: "method not allowed" }, 405, cors);
    }

    const url = new URL(req.url);
    if (!url.pathname.endsWith("/odds")) {
      return json({ error: "not found" }, 404, cors);
    }

    const date = url.searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ error: "missing or invalid ?date (YYYY-MM-DD)" }, 400, cors);
    }

    if (!env.ODDS_API_KEY) {
      return json({ error: "ODDS_API_KEY not configured on worker" }, 500, cors);
    }

    const apiUrl =
      "https://api.the-odds-api.com/v4/sports/baseball_mlb/odds" +
      `?apiKey=${encodeURIComponent(env.ODDS_API_KEY)}` +
      "&regions=us" +
      "&markets=h2h,totals" +
      "&oddsFormat=american" +
      "&dateFormat=iso";

    let upstream;
    try {
      upstream = await fetch(apiUrl);
    } catch (e) {
      return json({ error: "upstream fetch failed", detail: String(e) }, 502, cors);
    }

    const remaining = upstream.headers.get("x-requests-remaining");
    if (!upstream.ok) {
      const text = await upstream.text();
      return json(
        { error: "upstream error", status: upstream.status, body: text.slice(0, 400) },
        502,
        cors,
      );
    }

    let events;
    try {
      events = await upstream.json();
    } catch (e) {
      return json({ error: "upstream parse failed", detail: String(e) }, 502, cors);
    }

    const games = (Array.isArray(events) ? events : [])
      .filter((e) => commenceLocalETDate(e.commence_time) === date)
      .map((e) => ({
        commence_time: e.commence_time,
        home_team: e.home_team,
        away_team: e.away_team,
        home: medianFor(e, e.home_team),
        away: medianFor(e, e.away_team),
        total: medianTotal(e),
      }));

    return json(
      {
        updated_at: new Date().toISOString(),
        date,
        remaining,
        games,
      },
      200,
      cors,
    );
  },
};

function commenceLocalETDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

function medianFor(event, teamName) {
  const prices = [];
  for (const bk of event.bookmakers || []) {
    const mkt = (bk.markets || []).find((m) => m.key === "h2h");
    if (!mkt) continue;
    const out = (mkt.outcomes || []).find((o) => o.name === teamName);
    if (typeof out?.price === "number") prices.push(out.price);
  }
  if (!prices.length) return null;
  return { price: medianAmerican(prices), n_books: prices.length };
}

// Consensus over/under totals across US books. Lines are usually identical
// across books (e.g., everyone posts 8.5); when they differ we report the
// median line and the median over/under prices independently. Returns null
// if no book posted a totals market for this event.
function medianTotal(event) {
  const lines = [];
  const overPrices = [];
  const underPrices = [];
  for (const bk of event.bookmakers || []) {
    const mkt = (bk.markets || []).find((m) => m.key === "totals");
    if (!mkt) continue;
    const over = (mkt.outcomes || []).find((o) => o.name === "Over");
    const under = (mkt.outcomes || []).find((o) => o.name === "Under");
    const point = typeof over?.point === "number"
      ? over.point
      : (typeof under?.point === "number" ? under.point : null);
    if (point != null) lines.push(point);
    if (typeof over?.price === "number") overPrices.push(over.price);
    if (typeof under?.price === "number") underPrices.push(under.price);
  }
  if (!lines.length) return null;
  return {
    line: medianHalfPoint(lines),
    over: overPrices.length ? medianAmerican(overPrices) : null,
    under: underPrices.length ? medianAmerican(underPrices) : null,
    n_books: lines.length,
  };
}

// American odds median, rounded to integer (e.g., -110, +118).
function medianAmerican(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Total points line median, kept at 0.5 precision (lines come as 7, 7.5, 8…).
function medianHalfPoint(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m * 2) / 2;
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
