# Baseball App ⚾

A mobile-first MLB stats and live-game platform: real-time game tracking, a 3D
ball-flight visualization engine, player and matchup analytics, and a
projection "edge" model — built on a multi-source data pipeline that stitches
together the live MLB Stats API, Statcast, and FanGraphs.

**Live demo:** https://statsleuthgame.github.io/baseball-app/ · **API:** FastAPI service on Render

<!-- Add a screenshot or GIF of the live game view / 3D ball flight here — it's the single highest-impact thing you can add. -->

---

## Highlights

- **Live game tracking** — pitch-by-pitch strike zone, box score, win probability, and base/out state, polled from the MLB Stats API every 5 seconds.
- **3D ball-flight engine** — a custom React Three Fiber scene renders batted balls with drag-calibrated trajectory physics, animated runners and fielders, throw-to-base sequences, and cinematic camera rigs — tuned to stay smooth on phones.
- **Multi-source data pipeline** — live data from the MLB Stats API, pre-generated Statcast features from Baseball Savant, and scraped FanGraphs projections, unified behind one API with a static-first, live-fallback fetch strategy.
- **Analytics** — spray charts, strike-zone / missed-call (umpire) analysis, leaderboards, standings, and player profiles.
- **Projection edge model** — compares FanGraphs/Statcast-derived projections against posted prop lines to surface positive-expected-value plays (research and modeling exercise; see the disclaimer below).
- **Automated data refresh** — scheduled GitHub Actions regenerate projections, fantasy weights, and resolve prop-line history, committing fresh data back to the repo for the next deploy.

## Architecture

```
┌──────────────────────────────┐        ┌───────────────────────────────┐
│  Frontend (React 19 + Vite)  │        │   Backend (FastAPI, Python)   │
│  GitHub Pages                 │        │   Render (Docker)             │
│                               │  HTTP  │                               │
│  • React Router 7 (Hash)      │◀──────▶│  routers/  team, player,      │
│  • TanStack Query (polling)   │        │            matchup, umpire,   │
│  • React Three Fiber / three  │        │            fantasy, spraychart│
│  • D3 (charts) + custom SVG   │        │  services/ mlb_api, statcast, │
└───────────────┬───────────────┘        │            fangraphs, edge…   │
                │                         └───────────────┬───────────────┘
                │ live odds                               │
        ┌───────▼────────┐              ┌─────────────────▼─────────────────┐
        │ Cloudflare      │              │  Data sources                     │
        │ Worker          │              │  • MLB Stats API (live)           │
        │ (odds proxy —   │              │  • Baseball Savant / Statcast     │
        │  hides API key) │              │  • FanGraphs (scraped projections)│
        └─────────────────┘              └───────────────────────────────────┘
                         ▲
          Scheduled GitHub Actions regenerate & commit
          projections / fantasy weights / prop-line logs
```

The frontend tries pre-generated static JSON first and falls back to the live
MLB API, so common views are instant and resilient while live data stays
fresh. Live game state uses short React Query intervals (5s); less time-
sensitive data (rosters, standings) uses longer ones.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite, React Router 7, TanStack React Query, Axios |
| 3D / viz | React Three Fiber, drei, postprocessing, Three.js, D3 (scale/shape/array) |
| Backend | FastAPI, Uvicorn, httpx, pybaseball, BeautifulSoup, Pydantic v2 |
| Data | MLB Stats API, Baseball Savant (Statcast), FanGraphs |
| Infra | GitHub Pages (frontend), Render / Docker (API), Cloudflare Workers (odds proxy), GitHub Actions (scheduled data refresh) |

## Project structure

```
frontend/
  src/
    api/client.js          # All API calls (static + live), 60+ functions
    components/
      ballflight3d/         # 3D ball-flight engine (physics, camera, fielders, runners)
      team/                 # Live game, scoreboard, dashboard
      matchup/ player/ spraychart/ strikezone/
    context/                # Global team selection
    data/                   # Static team/park/stadium geometry
backend/
  app/
    routers/                # HTTP endpoints (team, player, matchup, umpire, fantasy…)
    services/               # Data providers (mlb_api, statcast, fangraphs, edge_model_picks…)
    models/                 # Pydantic response models
  Dockerfile · render.yaml
cloudflare/odds-proxy/      # Cloudflare Worker proxying The Odds API
.github/workflows/          # Deploy + scheduled data refresh
docs/                       # Accessibility audit, prop-edge research notes
```

## Running locally

**Backend** (FastAPI, Python 3.11+):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --reload --app-dir backend --port 10000
```

**Frontend** (Node 20+):

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The Vite dev server proxies `/api` requests to the local backend on port
10000 (see `frontend/vite.config.js`), so run the backend alongside it for
full functionality. Live MLB Stats API calls go directly from the browser.

### Optional: live odds proxy

The "Refresh Odds" feature reads from a Cloudflare Worker that proxies
[The Odds API](https://the-odds-api.com/) so the API key never reaches the
browser. See [`cloudflare/odds-proxy`](cloudflare/odds-proxy). Set
`VITE_ODDS_PROXY_URL` at build time to enable it; without it, the app simply
hides the odds UI.

## Deployment

- **Frontend** → GitHub Pages via `.github/workflows/deploy-frontend.yml` on every push to `main`.
- **Backend** → Render, built from `backend/Dockerfile` (`backend/render.yaml`).
- **Data** → `refresh-data.yml`, `refresh-fantasy.yml`, and `resolve-pp-lines.yml` regenerate data on a schedule and commit it back; the next deploy picks it up.

## Notes & disclaimer

This is a personal project and is not affiliated with or endorsed by MLB,
FanGraphs, or any data provider. All data is used for personal, educational,
and analytical purposes. The projection "edge" feature is a modeling and
research exercise — nothing here is betting advice.
