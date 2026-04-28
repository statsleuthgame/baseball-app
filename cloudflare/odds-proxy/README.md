# Odds Proxy (Cloudflare Worker)

Tiny Cloudflare Worker that holds the `ODDS_API_KEY` and returns pregame
moneyline odds for the Baseball App scoreboard. The deployed Pages frontend
calls this worker when the user clicks "Refresh Odds" — the key never leaves
the worker.

## Endpoint

Primary (path-based on the apex — corp DNS filters NXDOMAIN newly-seen
subdomains, so we route a path on the existing apex which is already in
corp resolvers' caches):

```
GET https://statmask.com/api/odds?date=YYYY-MM-DD
```

Fallbacks (same worker, additional hostnames):

```
GET https://data.statmask.com/odds?date=YYYY-MM-DD
GET https://odds.statmask.com/odds?date=YYYY-MM-DD
GET https://baseball-app-odds-proxy.codyostler.workers.dev/odds?date=YYYY-MM-DD
```

`date` is interpreted in **America/New_York** (matches MLB's local-game-day
convention, so a 10pm PT game on the West Coast lands on the same date as
the rest of that day's slate).

### Response

```json
{
  "updated_at": "2026-04-27T18:30:00.123Z",
  "date": "2026-04-27",
  "remaining": "498",
  "games": [
    {
      "commence_time": "2026-04-27T23:05:00Z",
      "home_team": "Seattle Mariners",
      "away_team": "Houston Astros",
      "home": { "price": -135, "n_books": 7 },
      "away": { "price": 118, "n_books": 7 },
      "total": { "line": 8.5, "over": -110, "under": -110, "n_books": 7 }
    }
  ]
}
```

- `home.price` / `away.price` — **median** American-odds for the moneyline
  (h2h) across US books. `null` if no book posted that side.
- `total.line` — median over/under points across books, snapped to 0.5.
- `total.over` / `total.under` — median American price for each side at the
  consensus line.
- Any field is `null` when no book offered that market for the event.

CORS allowlist: `https://statsleuthgame.github.io`, `http://localhost:5173`,
`http://localhost:4173`. Edit `ALLOWED_ORIGINS` in `src/index.js` to extend.

## One-time deploy

```bash
# 1. Install wrangler globally (one-time across all your projects)
npm install -g wrangler

# 2. From this directory:
cd cloudflare/odds-proxy
npm install
wrangler login

# 3. Set the secret (paste the key from Edge/.env when prompted)
wrangler secret put ODDS_API_KEY

# 4. Deploy
wrangler deploy
```

`wrangler deploy` prints the worker URL, e.g.
`https://baseball-app-odds-proxy.codyostler.workers.dev`.

## Wire to the frontend

Set `VITE_ODDS_PROXY_URL` to that URL in two places:

- **Local dev**: `frontend/.env.local` →
  `VITE_ODDS_PROXY_URL=https://baseball-app-odds-proxy.<account>.workers.dev`
  (or `http://localhost:8787` when running `wrangler dev`)
- **Production (GitHub Pages)**: GitHub repo → Settings → Secrets and variables
  → Actions → **Variables** tab → New variable `VITE_ODDS_PROXY_URL`. Then
  re-run the `Deploy Frontend` workflow (or push any commit) so the new
  variable is baked into the build.

## Local development

```bash
wrangler dev
# → http://localhost:8787

curl 'http://localhost:8787/odds?date=2026-04-27' | jq
```

## Cost

Every request to `/odds` costs **2 credits** against The Odds API quota
(`baseball_mlb` × `h2h` + `totals` markets — billed per market, per call).
Free tier is 500 credits/month, so the budget is roughly **8 refreshes/day**
across all users before the cap. Manual-only refresh keeps usage predictable;
if traffic ever exceeds the free tier, drop `totals` from the markets param
or move to a paid plan.
