// On-demand pregame moneyline proxy for the Baseball App scoreboard.
// Holds the The Odds API key as a Cloudflare Worker secret so the
// browser never sees it. Returns median American-odds across US books
// for every MLB game whose local-ET commence date matches ?date=YYYY-MM-DD.

const ALLOWED_ORIGINS = new Set([
  "https://statsleuthgame.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
]);

export default {
  async fetch(req, env) {
    const origin = req.headers.get("origin") || "";
    const cors = ALLOWED_ORIGINS.has(origin)
      ? {
          "Access-Control-Allow-Origin": origin,
          "Vary": "Origin",
        }
      : {};

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: { ...cors, "Access-Control-Allow-Methods": "GET, OPTIONS" },
      });
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
      "&markets=h2h" +
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
  prices.sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 1
      ? prices[mid]
      : Math.round((prices[mid - 1] + prices[mid]) / 2);
  return { price: median, n_books: prices.length };
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
