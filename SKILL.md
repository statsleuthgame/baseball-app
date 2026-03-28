---
name: baseball-app-patterns
description: Coding patterns and conventions for the Baseball App — a mobile-first React/FastAPI MLB stats and live game visualization platform
version: 1.0.0
source: local-git-analysis
analyzed_commits: 200
---

# Baseball App Patterns

## Project Overview

Mobile-first MLB baseball app with React 19 frontend (Vite), FastAPI backend, and a React Three Fiber 3D ball flight visualization system. Data sourced from MLB Stats API (live), Baseball Savant/Statcast (pre-generated), and FanGraphs (scraped).

## Tech Stack

- **Frontend**: React 19, Vite, React Router v7 (HashRouter), TanStack React Query
- **3D**: React Three Fiber + drei + Three.js (ball flight, stadium, fielders, runners)
- **Charts/Viz**: D3 (scales, shapes, arrays), custom SVG components
- **Data**: Axios + MLB Stats API (live), pre-generated static JSON (Statcast)
- **Backend**: FastAPI, pybaseball, httpx, pandas
- **Styling**: Single `index.css` with CSS variables, team-based theming

## Code Architecture

```
frontend/src/
├── api/client.js              # ALL API calls (60+ functions, static + live)
├── App.jsx                    # React Router routes
├── index.css                  # ALL styles (4500+ lines, CSS variables)
├── components/
│   ├── ballflight3d/          # 3D ball flight system (12 files)
│   │   ├── BallInPlay3D.jsx   # Orchestrator (Canvas, lights, animation state)
│   │   ├── Field3D.jsx        # Field geometry (grass, dirt, fence, foul poles)
│   │   ├── StadiumBackground.jsx  # Bowl, seats, mountains, sky dome
│   │   ├── AnimatedBall.jsx   # Ball flight with trail + landing impact
│   │   ├── BaseRunners3D.jsx  # Runner movement logic + animation
│   │   ├── Fielders3D.jsx     # 9 fielder positions + active fielder
│   │   ├── ThrowToBase.jsx    # Throw animations for outs/DPs
│   │   ├── CameraRig.jsx      # Camera presets + smooth transitions
│   │   ├── OutIndicator.jsx   # OUT flash effect
│   │   ├── trajectoryPhysics.js  # Drag-calibrated ball physics
│   │   └── eventClassifier.js # MLB event classification
│   ├── team/                  # Team-level pages
│   │   ├── LiveGamePage.jsx   # Live game view (strike zone, 3D, box score)
│   │   ├── Scoreboard.jsx     # All games today (scores tab)
│   │   ├── TeamDashboard.jsx  # Home tab
│   │   └── ...
│   ├── matchup/               # Game preview/matchup
│   ├── player/                # Player profiles + stats
│   ├── spraychart/            # Spray chart visualization
│   ├── strikezone/            # Strike zone + missed calls
│   ├── layout/                # AppShell, TopBar, TopTabs
│   └── common/                # Shared components
├── context/TeamContext.jsx    # Global team selection state
├── data/                      # Static data (teams, parks, stadium paths)
└── utils/formatters.js        # Formatting utilities
```

## Commit Conventions

**Descriptive imperative sentences** — no prefixes like `feat:` or `fix:`. Each commit message describes the change clearly:
- `Fix runner advancement on hits, gray defense with yellow fielder`
- `Add foul poles at fence endpoints`
- `Compact scores tab: ~31px saved per card, visual polish`
- `Poll live game state every 5 seconds instead of 15`

**Co-Author line** included on all Claude-assisted commits:
```
Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

~23% of commits are fixes, ~19% are additions, ~5% are removals. Rapid iteration with small, focused commits.

## Key Patterns

### Data Fetching — Dual Source (Static + Live API)

```js
// Pattern: Try static pre-generated data first, fall back to MLB API
export const fetchPlayerStats = async (playerId) => {
  try {
    const data = await staticFetch(`players/${playerId}/info.json`);
    if (data?.detail?.id) return { ...data, hasFullData: true };
  } catch (e) { /* fall through */ }

  // Fallback: MLB API
  const resp = await mlbApi.get(`/people/${playerId}`, { params: { hydrate: "currentTeam" } });
  // ...
};
```

### React Query — Polling for Live Data

```js
// Pattern: Short staleTime + refetchInterval for live data
const { data: liveState } = useQuery({
  queryKey: ["liveGameState", gamePk],
  queryFn: () => fetchLiveGameState(gamePk),
  enabled: !!gamePk,
  staleTime: 1000 * 5,
  refetchInterval: 1000 * 5,  // 5s for live state
});

// Pattern: Longer intervals for less-critical data
// Win probability: 30s, box score: 30s, roster: 1hr
```

### Three.js — Material Rules (Mobile Performance)

```
ALWAYS: meshLambertMaterial for lit surfaces
ALWAYS: meshBasicMaterial for unlit/sky/silhouettes
NEVER:  meshStandardMaterial or meshPhysicalMaterial in 3D scene
NEVER:  Shadow maps
LIMIT:  Dynamic lights to 2 (1 directional + 1 point)
USE:    dpr={[1, 1.5]} on Canvas
```

### Three.js — Geometry in useMemo

```jsx
// Pattern: ALL geometry created in useMemo, never in render or useFrame
const bowlGeo = useMemo(() => {
  const geo = new THREE.BufferGeometry();
  // ... build geometry
  return geo;
}, [fencePoints, normals]);
```

### Three.js — Refs for Animation State (NOT useState)

```jsx
// Pattern: Use refs for values read/written in useFrame
const landedRef = useRef(false);
const behindFenceRef = useRef(false);

useFrame((_, delta) => {
  if (landedRef.current) return;  // ref, not state
  // ... animation logic
  if (done) landedRef.current = true;  // no re-render
});
```

### Three.js — Module-Level Constants

```jsx
// Pattern: Constants outside component to avoid re-creation
const BASE_POS = {
  first: { x: 63.64, y: 3, z: -63.64 },
  second: { x: 0, y: 3, z: -127.28 },
  // ...
};

export default function BallInPlay3D({ hitData }) {
  // BASE_POS used in callbacks without stale closures
};
```

### Stadium Geometry — Fence-Point Extrusion

```js
// Pattern: Build bowl/seats from fence points, NOT LatheGeometry
// Compute outward normals for each fence point
const normals = fencePoints.map(([x, , z]) => {
  const dist = Math.sqrt(x * x + z * z) || 1;
  return [x / dist, z / dist];
});

// Extrude profile outward along normals
for (let f = 0; f < n; f++) {
  const [fx, , fz] = pts[f];
  const [nx, nz] = normals[f];
  const x = fx + nx * offset;
  const z = fz + nz * offset;
}
```

### Instanced Seats — Single Draw Call

```jsx
// Pattern: InstancedMesh with instanceColor for team-colored seats
<instancedMesh ref={seatMeshRef} args={[seatBlockGeo, null, seatCount]} frustumCulled={false}>
  <meshLambertMaterial vertexColors />
</instancedMesh>

// Colors set imperatively in useEffect
mesh.instanceColor = new THREE.InstancedBufferAttribute(seatColorArray, 3);
```

### Live Game State — Persisted Refs for Cross-Poll-Cycle Data

```js
// Pattern: Persist data in refs that survive API resets
const persistedHitDataRef = useRef(null);

useEffect(() => {
  if (liveState?.lastHitData) {
    persistedHitDataRef.current = liveState.lastHitData;
  }
}, [liveState?.lastHitData]);

// Use: const hitData = liveState.lastHitData || persistedHitDataRef.current;
```

### CSS — Single File with Team Theming

```css
/* Pattern: CSS variables for team colors, set dynamically */
:root {
  --team-primary: #0C2C56;
  --team-secondary: #00A3A3;
  --bg: #0a0e17;
  --bg-card: #141a28;
  --text: #c8cdd6;
  --text-bright: #f0f2f5;
  --text-muted: #6b7280;
}

/* Pattern: Class-based component prefixes */
.lgp-*    /* LiveGamePage */
.sb-*     /* Scoreboard */
.bip3d-*  /* BallInPlay3D */
.spray-*  /* SprayChart */
```

### Navigation — Player Links

```jsx
// Pattern: All player names are tappable, navigate to profile
<div className="sb-player-link" onClick={() => navigate(`/team/${teamId}/player/${playerId}`)}>
  {playerName}
</div>
```

## Data Generation

```bash
# Full generation (all 30 teams)
python scripts/generate_data.py

# Specific teams only
python scripts/generate_data.py SEA ATL

# Uses Statcast cache (.statcast_cache/) for incremental updates
# Output: frontend/public/data/
```

## Testing Workflow

- Build verification: `cd frontend && npx vite build`
- No formal test suite — visual verification via live game testing
- Review agents used for code quality (Senior Dev, Frontend, Integration)

## Common Pitfalls

1. **MLB API resets `allPlays` on half-inning change** — persist hit data in refs
2. **LatheGeometry revolves around origin** — don't use for stadium bowls (use fence-point extrusion)
3. **useState inside useFrame causes re-renders** — use refs for animation state
4. **Fence points wrap around home plate** — clip seats/bowl to fair territory using foul line angles
5. **Static pre-generated data can be stale** — supplement with live API calls for current season
6. **isOutEvent fallback was too aggressive** — explicitly list non-BIP events, don't default to "out"
