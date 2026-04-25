# Accessibility Audit — Baseball App Frontend

**Product:** Baseball App (Mariners/Braves fan dashboard)
**Standard:** WCAG 2.1 AA (with 2.2 overlap noted; AAA gaps flagged)
**Scope:** `frontend/` (Vite + React + React Router + React Query + react-three-fiber)
**Auditor:** AccessibilityAuditor
**Date:** 2026-04-24
**Tools referenced:** manual static review of JSX + CSS. No axe/Lighthouse run yet; SR testing treated as untested.

---

## Executive Summary

The app has a solid accessibility foundation in places — `prefers-reduced-motion` is honored globally (`index.css:7168-7173`), focus-visible outlines are defined (`index.css:39-46`), WAI-ARIA live regions are used on loading/error/status components (`LoadingSpinner.jsx:3`, `ErrorMessage.jsx:3`), most images have alt text, and the global `<html lang="en">` is set (`index.html:2`). Several components correctly use `<button>` with `aria-label`, and the standings table uses `<caption>` + `scope="col"` + `<abbr title>` headers (`StandingsCard.jsx:47-58`).

However, the app fails WCAG 2.1 AA overall. The dominant anti-pattern — pervasive use of `<div onClick>` and `<span onClick>` for interactive rows (scoreboard, schedule, matchup lineups, hot/cold, win-prob drilldowns, live game panels, collapsible sections, etc.) — means keyboard-only users cannot reach or activate large portions of the UI. This single pattern accounts for 25+ concrete barriers. Custom ARIA is inconsistent (tablists missing `aria-controls`/`tabpanel`, disclosures missing `aria-expanded`). Data-viz surfaces (spray chart, strike zone, 3D ball flight, win probability) have accessible SVG names but no text-alternative data tables, no keyboard interaction for dots, and no focus indicators. There is no skip-to-content link, the top-tabs uses a NavLink pattern rather than ARIA tabs, and touch targets on the scoreboard expand hint and inning segments are below 44×44.

### Top 5 Critical Barriers

1. **Pervasive `div`/`span` `onClick` handlers with no keyboard support** — the majority of interactive rows across Scoreboard, Matchup, Schedule, LeagueLeaders, TeamHotCold, and others are unreachable/unactivatable by keyboard users. (WCAG 2.1.1 Keyboard, 4.1.2 Name/Role/Value, 2.4.3 Focus Order). **15+ sites.**
2. **Interactive data-viz dots (spray chart, strike zone) are SVG-only click targets, not focusable, not keyboard-operable, no text alternative** — screen-reader and keyboard users cannot access individual hit/pitch details. (WCAG 2.1.1, 1.1.1 Non-text Content, 1.3.1 Info and Relationships).
3. **3D Ball Flight (`BallInPlay3D.jsx`) has no accessible name, no keyboard controls, no text alternative for the entire animated sequence, no pause/stop for the auto-playing animation** — violates WCAG 2.2.2 Pause/Stop/Hide and 1.1.1.
4. **Tab patterns are broken** — `TopTabs` uses `<NavLink>` inside a `<nav>` (not a real tablist, but the bottom-bar style uses tab affordance); `FullStandings` uses `role="tablist"`/`role="tab"` without `aria-controls`, `tabpanel`, or arrow-key navigation; `MissedCallsPanel`/`LeagueLeaders`/`Scoreboard` `GameDetail` all render tab-style buttons without any ARIA at all. (WCAG 4.1.2, WAI-ARIA APG).
5. **Search input in `TopBar` does not trap focus in its modal, does not return focus to trigger on close, and the overlay lacks `role="dialog"` with `aria-modal="true"`** — keyboard users get lost. Overlay click-outside-to-close is keyboard-inaccessible. (WCAG 2.4.3, 2.1.2 No Keyboard Trap-adjacent, APG Dialog).

Overall WCAG conformance: **Does not conform**. Assistive-technology compatibility: **Fail** (untested, but multiple blocking defects verified statically).

---

## Findings Table

Severity: **Critical** = blocks access for some users, **Serious** = major barrier with workaround, **Moderate** = causes difficulty, **Minor** = annoyance.

| # | Severity | WCAG | File : Line | Description | Recommended Fix |
|---|----------|------|-------------|-------------|-----------------|
| 1 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/team/TodayGame.jsx:52` | Outer live-game card is `<div onClick>` with `cursor:pointer`, no role/tabindex/keydown. | Wrap as `<button>` or add `role="button" tabIndex={0}` + `onKeyDown` (Enter/Space). Better: use a real button or `<Link>`. |
| 2 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/team/TodayGame.jsx:134` | `GameCard` outer `div onClick={onTap}` — entire card is a click target. Additionally nests `<button>` inside it (line 147, 168), causing nested-interactive semantics. | Make the card a `<button>` or convert to `<a href>` that wraps only text; move the inner team-logo links out to a sibling row so there are no nested interactives. |
| 3 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/team/TodayGame.jsx:183,199` | Probable-pitcher rows are `<div onClick>` navigate. Keyboard users cannot activate. | Change to `<button type="button">` with appropriate `aria-label`. |
| 4 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/matchup/MatchupView.jsx:125` | `matchup-header` div has conditional `onClick` with no keyboard equivalent. Also contains nested `<button>` team links — nested interactive. | Convert to button, or separate tap target from the buttons inside. |
| 5 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/matchup/MatchupView.jsx:352,363` | Lineup rows `<div className="matchup-lineup-row sb-player-link" onClick>` — no keyboard support. | Convert each row to `<button>` or `<Link>`. Same issue repeats at `:607,:618,:665,:855`. |
| 6 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/matchup/MatchupView.jsx:517` | `matchup-edge-row` div onClick navigates to player — keyboard-inaccessible. | Use `<button>` element for the row. |
| 7 | Critical | 4.1.2, 1.3.1 | `frontend/src/components/matchup/MatchupView.jsx:879` | `CollapsibleSection` header is a `div onClick={() => setOpen(!open)}` with `<h3>` inside — no `<button>`, no `aria-expanded`, no `aria-controls`, no `region`/`tabpanel`. 10+ collapsible sections on Matchup page are all silent to screen readers. | Replace header with `<button aria-expanded={open} aria-controls={panelId}>`, wrap content in `<div id={panelId} role="region">`. Keep h3 inside the button or as caption. |
| 8 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/schedule/ScheduleView.jsx:93` | `schedule-row` is `<div onClick>` with `cursor:pointer` — every row in the schedule unreachable by keyboard. | Convert to `<button>` or `<Link to={...}>`. 162-game schedule × 0 keyboard access. |
| 9 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/team/Scoreboard.jsx:809-817` | Scoreboard card is `<div role="button" tabIndex={0} onClick onKeyDown>` — correct pattern for one card, but contains nested `<button>` team-link children (855-860, 870-878). Nested interactives. | Remove outer `role=button` and make the whole card a `<Link>` with team chips as a separate sibling row, OR keep cards as buttons but remove the inner team buttons. Also applies to our-game watch button `<button>` nested inside the card. |
| 10 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/team/Scoreboard.jsx:84-92,346,422,541,556,630,641,161,905,913,922` | `sb-player-link` divs and spans with `onClick` (+ sometimes `role="link" tabIndex={0}` but **no** `onKeyDown`). 10+ call sites. | Replace with `<button>` or `<Link>`. Current role+tabIndex without key handler is worse than nothing — screen readers announce "link" but Enter does nothing. |
| 11 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/team/Scoreboard.jsx:342` | `sb-batter-row` onClick toggles at-bat detail with no button/aria-expanded. | Convert wrapper to `<button aria-expanded>`; the chevron SVG becomes decorative. |
| 12 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/team/StandingsCard.jsx:61` | `<tr>` clickable with `onClick`+`cursor:pointer`, no keyboard handler, no `<button>` inside cells. Works in SRs as a row but not as a link. | Wrap the team-name cell contents in a `<button>` or `<Link>` instead of making the row clickable. |
| 13 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/team/FullStandings.jsx:387-392` | Same `<tr onClick>` pattern in full standings. | Same fix — link inside the first cell. |
| 14 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/team/LeagueLeaders.jsx:59-67` | `leaders-row` div onClick navigates — no keyboard. | Convert to `<button>`. |
| 15 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/team/UpcomingSeries.jsx:48,54` | Pitcher name `<span onClick>` with no keyboard/role — keyboard-inaccessible. | Convert to `<button>`. |
| 16 | Critical | 2.1.1, 4.1.2 | `frontend/src/components/matchup/BatterVsPitcher.jsx:67,80` | BvP rows are `<div onClick>` — keyboard-inaccessible. | `<button>` or `<Link>`. |
| 17 | Critical | 2.1.1, 1.1.1, 1.3.1 | `frontend/src/components/spraychart/HitDots.jsx:100-106` | Hit dots are `<circle onClick>` inside SVG with no focusable wrapper, no `role`, no `aria-label`, no keyboard handler. Every hit's details (exit velo / LA / distance / date / pitcher) is keyboard-inaccessible and invisible to screen readers. | Add `tabIndex="0"`, `role="button"`, `aria-label={describeHit(hit)}`, and `onKeyDown` for Enter/Space. Provide a linked data table below the chart as a text alternative. |
| 18 | Critical | 2.1.1, 1.1.1 | `frontend/src/components/strikezone/MissedCallDots.jsx:53-59` | Same as #17 — missed-call dots are SVG `<circle>` onClick with no keyboard/SR support. | Same fix: focusable circles, or provide a sibling data table of missed calls. |
| 19 | Critical | 1.1.1, 2.2.2, 2.1.1 | `frontend/src/components/ballflight3d/BallInPlay3D.jsx:199-324` | Three.js `<Canvas>` renders an auto-playing animated ball-flight sequence. No accessible name on the canvas, no text alternative describing what happens in the animation, no pause/stop control, animation auto-starts (`useEffect` line 102 `setIsPlaying(true)`), `prefers-reduced-motion` is not checked in this component. Metrics overlay is decorative-only (no `aria-live`). | Add `aria-label` to the canvas wrapper, a `role="img"` with `aria-describedby` to the metrics panel. Provide a pause/replay button as the primary surface (handleReplay exists but only fires after completion). Respect `prefers-reduced-motion` in-component — if set, skip animation and show a static summary with the metrics. Provide a textual recap ("Home run, 112 mph, 425 ft, bases loaded, 4 runs score") in an `aria-live="polite"` region. |
| 20 | Critical | 2.1.2, 2.4.3, 4.1.2 | `frontend/src/components/layout/TopBar.jsx:208-264` | Search overlay: has `role="dialog"` + `aria-label` but missing `aria-modal="true"`. No focus trap — tabbing exits to the page behind. Esc closes (good, line 148), but overlay-click only closes on mouse (no keyboard-equivalent). Focus auto-moves to input on open (line 57-60) but **does not return to the search button on close** (the button that opened it). | Add `aria-modal="true"`. Implement focus trap inside the dialog (e.g. `focus-trap-react` or manual Tab/Shift-Tab loop). Store the trigger element and `.focus()` it in `closeSearch`. Consider `<dialog>` element with `showModal()`. |
| 21 | Critical | 2.4.1 | global | No skip-to-content link exists. Keyboard users must Tab through header + search + edge + stats + switch + 5 tab links on every page before reaching main content. | Add `<a href="#main-content" className="sr-only sr-only-focusable">Skip to content</a>` as the first focusable element in `App.jsx`. Give `<main>` `id="main-content"`. |
| 22 | Serious | 4.1.2, APG Tabs | `frontend/src/components/team/FullStandings.jsx:51-63` | `role="tablist"` + `role="tab"` + `aria-selected` applied, but: no `aria-controls` pointing to the corresponding panel, no `role="tabpanel"` on the body, no arrow-key navigation between tabs, no `tabIndex` management (selected tab should be `0`, others `-1`). | Follow WAI-ARIA APG Tabs pattern. Add ids + `aria-controls` + `role="tabpanel"` on `.full-standings-body`, handle ArrowLeft/ArrowRight/Home/End. |
| 23 | Serious | 4.1.2, APG Tabs | `frontend/src/components/strikezone/MissedCallsPanel.jsx:59-89` | Tab-style button groups (dots/heatmap view, all/squeezed/gifted call filter) have no `role="tablist"`, no `aria-selected`, no `aria-controls`. Acts as a segmented control. | Either apply the full tabs pattern or use `aria-pressed` to convey toggle state. Wrap group in `role="group" aria-label="View mode"`. |
| 24 | Serious | 4.1.2, APG Tabs | `frontend/src/components/team/LeagueLeaders.jsx:45-48` | Hitting/Pitching tabs lack `role="tab"` / `aria-selected`. | Apply APG Tabs pattern or `aria-pressed`. |
| 25 | Serious | 4.1.2, APG Tabs | `frontend/src/components/team/Scoreboard.jsx:456-457` | `GameDetail` Scoring/Box Score tabs — same issue. | Same fix. |
| 26 | Serious | 4.1.2 | `frontend/src/components/layout/TopTabs.jsx:19-45` | `<nav aria-label="Main navigation">` with `NavLink`s using `aria-current="page"` is correct for top-level navigation, NOT a tab pattern — good. But the class is called `top-tab` / `top-tab-active` which implies tab. If product intent is tabs within the team view, rebuild as `role="tablist"` + ArrowKey navigation. Otherwise keep as nav (current markup is fine) and rename CSS. | Confirm intent. Either add full tabs ARIA or accept as nav (markup is acceptable as nav). |
| 27 | Serious | 4.1.2 | `frontend/src/components/matchup/MatchupView.jsx:706-712` | `GameSwitcher` "All Games" toggle is a `<button>` with no `aria-expanded`, no `aria-haspopup`, dropdown not marked as menu/listbox. | Add `aria-expanded={open}`, `aria-haspopup="true"`, give dropdown `role="menu"` and items `role="menuitem"`. Close on Esc. |
| 28 | Serious | 2.1.1, 2.1.2 | `frontend/src/components/matchup/MatchupView.jsx:713-728` | When GameSwitcher dropdown is open, Esc does not close it, clicking outside does not close it. | Add `onKeyDown` Esc handler + outside-click listener. Return focus to the toggle button. |
| 29 | Serious | 1.3.1 | `frontend/src/components/player/PlayerDetail.jsx:74` | Page heading is `<h2>` — skipped `<h1>`. Top-bar shows the **team name** as h1 on every page, which is misleading for a player-detail view. | Each route should have its own h1 (e.g. player name). Consider moving the team-name h1 to the `<main>` area or adjusting so the player name is the h1 of the page. |
| 30 | Serious | 1.3.1 | `frontend/src/components/spraychart/SprayChart.jsx:135` | Page heading is `<h2>`. No h1 on the spray-chart route. | Make page title an `<h1>`. Same for `MissedCallsPanel:54` (h3), `MatchupView` (no h1), `Scoreboard` (no h1), `RosterGrid` (no h1, only h3 groups), `ScheduleView` (no h1). |
| 31 | Serious | 1.3.1 | `frontend/src/components/team/TeamDashboard.jsx` | TeamDashboard (home) has no visible h1 — its child cards start at h3 (`section-title`, `standings-header` is h2, `leaders-card` h3). The team name in TopBar is h1 but outside `<main>`, so the main region's heading hierarchy is h2 → h3 with no h1. | Add an `<h1 class="sr-only">{team.name} Dashboard</h1>` at top of `TeamDashboard.jsx`, or demote team name in TopBar to a non-heading and hoist it into each page. |
| 32 | Serious | 1.4.3 | `frontend/src/index.css:215` (top-bar-edge), `:246` (top-bar-stats) | Icon-button color #22c55e on the navy `--team-primary: #0C2C56` (Mariners) gives ~3.6:1 contrast ratio — below 4.5:1 for non-text. The rule 1.4.11 (non-text contrast ≥ 3:1) is met; however, once focused the `:focus-visible` outline is green too, which may be hard to see on dark-on-dark teams. Combined opacity 0.85 drops effective contrast further. | Remove `opacity: 0.85` default; use full opacity. Verify against all 30 team primary colors — the header uses `var(--team-primary)` which varies wildly. |
| 33 | Serious | 1.4.3 | `frontend/src/components/matchup/WinProbability.jsx:116-129` | Axis labels use `#9299ad` on `#0d1117`-ish backgrounds at `fontSize="8"` (scaled SVG). When the SVG renders small (mobile) these pixels are ~10px physical, under 4.5:1 (#9299ad on #0d1117 ≈ 4.9:1 — borderline). "Inning" axis title is also 8px. | Bump axis text to minimum 10px rendered, or raise color to `#b8bdcd` (5.8:1). |
| 34 | Serious | 1.4.3 | `frontend/src/index.css` many places | `color: var(--text-muted)` = `#a3aabe` on `--bg-card: #141a28` computes to ~5.6:1 — OK for body text. However, `.umpire-label` etc. use `font-size: 10px` (`index.css:7194`) which is below WCAG's assumed 14pt large-text threshold and the actual rendered type is tiny. Dense stat pages (`.sb-batter-stat`, `.sb-lu-pos`, etc.) use 11-12px text. | Raise small-text minimums to 12px. Small text ≥ 4.5:1 contrast already, but at 10-11px, readers struggle regardless of ratio. |
| 35 | Serious | 1.4.1 | `frontend/src/components/strikezone/MissedCallsPanel.jsx:146-153` | Squeezed (red) vs Gifted (blue) distinguished by color only in the dots themselves — the legend uses a colored dot, but the SVG dots are visually identical shapes differing only in fill. Screen readers have no handle on which is which. | Use shape differentiation (e.g. triangle vs circle, or filled vs outlined). Add text-alternative data table. |
| 36 | Serious | 1.4.1 | `frontend/src/components/spraychart/HitDots.jsx:107-116` | Hit outcome conveyed by color only (green single, blue double, orange triple, red HR, gray out). | Either use shape + color (hollow circle for out, etc. — star shape already used for longest HR is a good precedent), or always show a labelled legend + text alternative. |
| 37 | Serious | 1.4.1 | `frontend/src/components/team/FullStandings.jsx:406` | `streak-w` green / `streak-l` red classes convey win/loss using color alone (unless the "W5" / "L3" text is present, which it is — **OK** here, text carries the info). But `.diff-pos` green / `.diff-neg` red on run differential (`:411`) — the +/- sign is present, again redundant. Hotcold tags `.hot` / `.cold` — labels exist in text. | **Mostly OK** because text labels exist. Verify no color-only use in edge score chips `matchup-edge-tier-*` and hotcold dots — looks fine, confidence label is text. |
| 38 | Serious | 1.4.4 | `frontend/src/index.css:25` | Root `font-size: 16px` is absolute pixels (not `rem`/`em`), and most component sizes are px-based. Users who zoom text (browser text size override) may not get proportional scaling. | Use `rem` / `em` for typography throughout. Keep the 16px base but declare sizes relative to it so zoom works predictably. |
| 39 | Serious | 2.4.4 | `frontend/src/components/team/Scoreboard.jsx:951-963` | "Gameday" link to mlb.com opens in current tab (no target), and has `aria-label="View on MLB Gameday"` but no indication it's external. The `TopBar:38-40 openEdgeDashboard` does open in `_blank` with `noopener,noreferrer` and labels as "(opens in new tab)" — good pattern. Gameday link should follow suit. | Add `target="_blank" rel="noopener noreferrer"` and update aria-label to include "(opens in new tab)". Or move to `_self` explicitly. |
| 40 | Serious | 2.5.5 (AAA) / 2.5.8 (2.2 AA) | `frontend/src/index.css:407-467` (top-tabs), `:943` (sb-expand-hint) | Top tabs `.top-tab` at `padding: 10px 0` + `font-size: 13px` may produce <44×44 touch targets in narrow viewports. Scoreboard "Stats" chevron `.sb-expand-hint` appears small. Month-pills in `ScheduleView` (`.month-pill`) are unknown size. WCAG 2.2 introduces 2.5.8 Target Size (Minimum) at 24×24 CSS px as AA, with 44×44 as 2.5.5 AAA. | Ensure every interactive element is ≥ 24×24 CSS px (AA) and strive for 44×44. Inspect: `.top-tab`, `.month-pill`, `.sb-expand-hint`, `.mc-legend-dot`, `.bullpen-status-dot`, search icon in overlay, ScoreDisplay flashing score (static). |
| 41 | Serious | 1.3.1, 4.1.2 | `frontend/src/components/matchup/MatchupView.jsx:707,719` | `game-switcher-btn` and dropdown items are native `<button>` but the dropdown wrapper is a `<div>` — no `role="menu"` / `listbox`. Mobile: open state is not announced. | Use APG menu pattern or `<select>` if the UI allows. |
| 42 | Serious | 4.1.2 | `frontend/src/components/ballflight3d/BallFlight3DDemo.jsx:247-306` | Range inputs (`type="range"`) have visible `<label>` text but the label is not associated with the input (label wraps input but the text is a sibling, not an explicit `<label for>` / nesting that SR tools recognize reliably). Also, three range sliders are in one `<label>` with text and `<strong>` — the label text "Exit Velocity: 105 mph" is not a programmatic label with stable text; SR will read it once on focus but not update on change. | Use separate `<label for={id}>` + `<input id={id}>`. Announce current value via `aria-valuetext` or a visually-connected `aria-describedby`. |
| 43 | Serious | 4.1.2 | `frontend/src/components/ballflight3d/BallFlight3DDemo.jsx:295-305` | "Runners On Base" group of buttons (1B/2B/3B) has no `role="group"`, no `aria-label`, no `aria-pressed`. | Add `role="group" aria-label="Runners on base"`. Each toggle button should have `aria-pressed={customRunners[base]}` instead of just className `.active`. |
| 44 | Serious | 2.2.2 | `frontend/src/index.css:4024, 4124, 4264, 4735, 5751, 5893, 6618, 6860` | Multiple `animation: ... infinite` — "live" pulsing dots, jumbo glows, etc. The global `@media (prefers-reduced-motion)` rule kills these (good). But absent that preference, three+ infinite animations can simultaneously appear on one scoreboard card (live-dot-flash + jumbo-live-glow + score-flash). WCAG 2.2.2 requires mechanism to pause/stop moving content that auto-starts and runs more than 5s. | The reduced-motion media-query is sufficient compliance for the 2.2.2 AA threshold **only** for users with that preference. Consider a "pause animations" toggle for users without the OS preference. Verify no animation > 5s without user-controllable pause. |
| 45 | Serious | 4.1.2 | `frontend/src/components/team/LiveGamePage.jsx:39-49` | `formatScoringDesc` builds HTML string with `<strong>` tags and `dangerouslySetInnerHTML`. If injected (line 44 searches for "homers" etc.) — XSS is mitigated by the escape step but the resulting markup is inserted via `dangerouslySetInnerHTML` (need to confirm downstream). SR: emphasis is conveyed, OK. Accessibility-wise, the concern is reliance on innerHTML injection for accessible output. | Consider rendering as React elements (already done in `Scoreboard.jsx:479-485` — use the same pattern on LiveGamePage). |
| 46 | Moderate | 1.3.1 | `frontend/src/components/team/Scoreboard.jsx:178-212` | Linescore `<table>` uses `<thead>`/`<tbody>` but `<th>` cells don't have `scope` attribute. Row-header cell for team abbreviation is a `<td>` (line 193), not `<th scope="row">`. | Add `scope="col"` to column headers, change team-abbr cells to `<th scope="row">`. Add `<caption>` describing linescore. |
| 47 | Moderate | 1.3.1 | `frontend/src/components/player/ContractCard.jsx:105-111` | Contract yearly table `<th>` elements lack `scope="col"`. | Add `scope="col"`. |
| 48 | Moderate | 1.3.1 | `frontend/src/components/player/PitchArsenal.jsx:84-94` | Arsenal table `<th>` elements lack `scope="col"`. No caption. | Add `scope="col"` and `<caption className="sr-only">Pitch Arsenal for {playerName}</caption>`. |
| 49 | Moderate | 1.3.1 | `frontend/src/components/team/Scoreboard.jsx:383-400` | `TeamBoxScore` is a DIV layout imitating a table (`.sb-team-box`, `.sb-batter-row` spans). Tabular data but no table semantics → no column-header association in SRs. | Convert to `<table>` with proper `<th scope="col">`. Same for `TeamPitchingBox`, `sb-lineups`, `matchup-lineups`, `bvp-list`, `hotcold-list` rows — anything that's rows/cols of data. |
| 50 | Moderate | 4.1.2 | `frontend/src/components/player/BatterStats.jsx:33-41`, `PitcherStats.jsx:29-37` | Season `<select>` has no associated `<label>` — only an adjacent h3. No `aria-label`. | Add `aria-label="Select season"` or visible `<label>`. |
| 51 | Moderate | 1.3.1, 4.1.2 | `frontend/src/components/team/TodayGame.jsx:222-236` | "Watch" button uses `window.location.href = ...` instead of `<a href>` — not identifiable as a link to SR users. Same pattern at `Scoreboard.jsx:934-947`. | Replace with `<a href target="_blank">`. Buttons that navigate externally should be links. |
| 52 | Moderate | 1.3.1 | `frontend/src/components/matchup/MatchupView.jsx:118,119,120` | `matchup-preview-title` is a plain `<div>` styled like a heading, not a heading element. | Use `<h2>` or appropriate heading level. |
| 53 | Moderate | 1.3.1 | `frontend/src/components/team/Scoreboard.jsx:776,826,987,993,1001,1010` | Multiple `<h3>` section headers sit directly under an unknown h1 — because the Scoreboard route has no h1. Also `<h2>No Games</h2>` inside empty state (`:776`) is the only h2 on the page. | Add a page-level h1 for Scoreboard. |
| 54 | Moderate | 4.1.2 | `frontend/src/components/ballflight3d/BallFlight3DDemo.jsx:308-310` | Fire button label contains an emoji (🔥 + "Launch Ball"). Screen readers may announce "fire emoji Launch Ball" depending on SR settings. | Wrap emoji in `<span aria-hidden="true">🔥</span>` and keep text label. |
| 55 | Moderate | 1.1.1 | `frontend/src/components/team/Scoreboard.jsx:22-35` weatherIcon | Weather condition rendered as emoji only (☀️, 🌧️, ⛅). No accessible text name for the icon value in the scoreboard weather strip. | Wrap in `<span aria-hidden="true">` and add visually-hidden text ("Sunny"). |
| 56 | Moderate | 4.1.2 | `frontend/src/components/ballflight3d/BallInPlay3D.jsx:278-284` | The `.bip3d-event-label` with live out count (`— {outs} Out`) changes during the animation but is not inside an `aria-live` region. SR users miss the state change. | Add `aria-live="polite"` to the label container, or to a sibling status region. |
| 57 | Moderate | 4.1.2 | `frontend/src/components/team/Scoreboard.jsx:308` | `ScoreDisplay` flashes class `sb-score-just-changed` when score changes but is not in a live region. SRs don't announce score changes. | Add `aria-live="polite" aria-atomic="true"` to the score span so changes are announced. |
| 58 | Moderate | 4.1.2 | `frontend/src/components/team/Scoreboard.jsx:574-579` | `sb-last-play` has `aria-live="polite"` — good. But the live state wrapper `LiveGameInfo` updates batter, count, outs every 20s; none of it is in a live region. | Selectively mark critical updates (outs, count) as polite live regions. |
| 59 | Moderate | 2.1.1 | `frontend/src/components/layout/AppShell.jsx:114` | `<main tabIndex={-1} ref>` receives focus programmatically on route change (line 59). Good for SR route announcements. However, `<main>` needs a label when there are multiple landmarks — currently no `aria-label`, ambiguous on pages with multiple main-type regions. | Add `aria-label="Main content"` to `<main>`, add a `role="region" aria-labelledby` to section groups that need identification. |
| 60 | Moderate | 2.4.2 | `frontend/src/components/layout/AppShell.jsx:38-43` | `document.title` is set via effect — good — but PAGE_TITLES map (`:12-19`) is incomplete: no entry for "player", "live", "edge", "standings", "ballflight3d". Player page falls back to literal "Player" without the player name; live page falls back to "Player". | Expand PAGE_TITLES; for player/live, derive from page data (player name, game matchup). |
| 61 | Moderate | 1.1.1 | `frontend/src/components/team/TodayGame.jsx:64,80,153,174` | `alt={team.away.abbreviation}` — team logos use abbreviation as alt. Acceptable, but an SR user hears "SEA" then "SEA" again immediately (since the abbr text is also rendered). Could be decorative since the team name text follows. | Set `alt=""` on the logo and keep the text. Applies broadly: `TopBar.jsx:167` (team logo has "{name} logo" — OK), `series-logo`, `matchup-logo`, `scoreboard-logo`, `schedule-logo`, `offday-logo`, etc. — most should be `alt=""` since adjacent text duplicates. |
| 62 | Moderate | 1.1.1 | `frontend/src/components/team/Scoreboard.jsx:820` | Watermark logo has `alt=""` — correct (decorative). Good example. |
| 63 | Moderate | 1.3.1 | `frontend/src/components/common/PlayerPhoto.jsx:10-12` | Photo fallback uses `<div role="img" aria-label>` — good. Initials inside are `aria-hidden` — good. But actual `<img>` uses `alt={name \|\| "Player"}` — fine. |  No change needed, confirmed OK. |
| 64 | Moderate | 4.1.2 | `frontend/src/components/common/ErrorBoundary.jsx:15-25` | Error UI has inline styled button with no `type="button"` (defaults to submit inside forms) and no aria-label. Acceptable text. | Add `type="button"`. Wrap in `role="alert"` so SR announces immediately. |
| 65 | Moderate | 2.4.7 | `frontend/src/index.css:4024-4030` | `.top-tab` has no `:focus-visible` rule — relies on global `:focus-visible` (`:39`) which applies a green outline, **BUT** outline offset + green on a dark bg-card is low-contrast. The "active" tab already has underline; focus state should be clearly different from active. | Explicit `.top-tab:focus-visible { outline: 2px solid white; outline-offset: 2px; }`. |
| 66 | Moderate | 4.1.2 | `frontend/src/components/team/BettingEdge.jsx:328-334` | Checkbox label wraps input — good pattern — but no `aria-label` on the native checkbox and the `<span>` text "My Teams only" is the accessible name via wrapping, which some older AT can miss. | Make explicit: `<label htmlFor="my-teams"><input id="my-teams" ...>`. Works the same visually. |
| 67 | Moderate | 1.3.1 | `frontend/src/components/team/BettingEdge.jsx:288-309` | `<h1 className="edge-title">` inside route-level `<header>` — good. But the `$` span is `aria-hidden` (good) while screen readers hear "TODAY'S EDGE". Fine. | OK. |
| 68 | Moderate | 4.1.2 | `frontend/src/components/team/BettingEdge.jsx:542-548` | Details toggle: `aria-expanded={open}` present (good). Label uses "▴ Hide" / "▾ Details" (triangles in text). SR reads "black up-pointing small triangle Hide" depending on punctuation level. | Replace triangle chars with `<span aria-hidden="true">` decorative icons. |
| 69 | Moderate | 1.1.1 | `frontend/src/components/spraychart/BallparkSVG.jsx:65-66` | `<svg role="img" aria-label={`Spray chart at ${parkName}`}>` — good accessible name. But the whole chart lacks an `<title>` / `<desc>` describing what's plotted (how many hits, distribution). | Add `<title>` and `<desc>` children for complete description. Still need a tabular fallback as per #17. |
| 70 | Moderate | 1.1.1 | `frontend/src/components/strikezone/StrikeZoneSVG.jsx:40` | `<svg role="img" aria-label="Strike zone missed calls">` — OK but generic. | Include the specific count in the label ("Strike zone: 12 squeezed, 8 gifted"). |
| 71 | Moderate | 4.1.2 | `frontend/src/components/matchup/WinProbability.jsx:85-87` | `<svg role="img" aria-label={detail%}>` — good. But the chart updates every 30s (refetchInterval line 18) and the aria-label does not re-announce in SR because static labels don't trigger announcements. | Add a sibling `<div aria-live="polite" className="sr-only">{updateText}</div>` that updates when probability changes. |
| 72 | Moderate | 1.3.5 | `frontend/src/components/layout/TopBar.jsx:216-225` | Search input has `type="text"` but could use `type="search"` + `autoComplete="off"`. | Use `type="search"`. No functional break. |
| 73 | Moderate | 2.5.3 | `frontend/src/components/team/TodayGame.jsx:223-235` | Button visible text is "Watch" but `aria-label` is "Watch live game" / "Open in MLB app" — the accessible name differs from visible text. WCAG 2.5.3 requires accessible name starts with visible text. | Make `aria-label` start with "Watch" (e.g. "Watch live game in MLB app"). |
| 74 | Moderate | 2.5.3 | `frontend/src/components/team/StandingsCard.jsx:37-45` | Button text is "Full Standings" but `aria-label="View full standings"` — reasonable, still starts with verb. Acceptable. Confirm all aria-labels include visible text. Similar at `BettingEdge.jsx:300` — visible "← Back" but label "Back to team dashboard" — OK, starts with "Back". | Audit all aria-labels for 2.5.3 compliance. |
| 75 | Moderate | 4.1.2 | `frontend/src/components/team/TodayGame.jsx:231-234` | SVG is an icon + visible text "Watch" — the svg is `aria-hidden="true"` inside a button → good. Same pattern at many places — confirmed OK. |  OK. |
| 76 | Minor | 3.3.2 | `frontend/src/components/layout/TopBar.jsx:220` | Search `placeholder="Search any MLB player..."` only — no visible label. Placeholder disappears on type. | Add visible label above input or `aria-labelledby` pointing to a visually-hidden label. |
| 77 | Minor | 3.3.2 | `frontend/src/components/team/TeamSelector.jsx:36-42` | Same — `placeholder="Search teams..."` with no persistent label. | Add label. |
| 78 | Minor | 3.3.2 | `frontend/src/components/spraychart/SprayChart.jsx:139-192` | Select inputs have `aria-label` — good — but the `<option value="">Select a player...</option>` uses placeholder-style text. Consider `disabled` on the placeholder option. | Set placeholder option `disabled`. |
| 79 | Minor | 1.1.1 | `frontend/src/components/team/Scoreboard.jsx:549-554` | Live diamond SVG (base runners) has no accessible name. The visual dots show base occupancy but SR users get nothing. | `role="img" aria-label={`Runners on ${describeBases(liveState)}`}`. |
| 80 | Minor | 4.1.2 | `frontend/src/components/team/Scoreboard.jsx:314-322` | `InningProgressBar` marked `aria-hidden="true"` — fine since status text is elsewhere. Good. | OK. |
| 81 | Minor | 1.1.1 | `frontend/src/components/layout/AppShell.jsx:104-107` | Pull-to-refresh SVG has no `role`/`aria-label`. It's transient decoration. | Add `aria-hidden="true"`. |
| 82 | Minor | 2.1.1 | `frontend/src/components/layout/AppShell.jsx:69-95` | Touch-based pull-to-refresh has no keyboard equivalent. Acceptable because it's an enhancement and react-query auto-refetches on mount/route change. Alternatively a visible "Refresh" button for keyboard users. | Add an accessible refresh button in TopBar. |
| 83 | Minor | 1.3.4 | all responsive breakpoints | No `orientation: portrait/landscape` restriction detected (good). Verify 400% zoom and `html { text-size-adjust: 100% }` work. Mobile-first layout should already satisfy 1.4.10 Reflow. |  Test at 400% zoom. |
| 84 | Minor | 3.2.1 (AAA) | `frontend/src/components/team/TeamSelector.jsx:41` | `autoFocus` on team selector search input. Moving focus on load is generally OK per 3.2.1, but some screen-reader users prefer to explore the page first. | Consider removing `autoFocus`. |
| 85 | Minor | 4.1.3 | `frontend/src/components/player/PlayerDetail.jsx:66-67` | Loading state renders `<SkeletonLoader>` — no live-region announcement of "Loading". SkeletonLoader does have `role="status" aria-label="Loading"` at `SkeletonLoader.jsx:3` — good. Confirmed OK. | OK. |
| 86 | Minor | 2.2.1 | `frontend/src/components/team/Scoreboard.jsx:664-671` | Date picker auto-triggers via `input.showPicker()` — date picker UX is native, accessible. Good. | OK. |
| 87 | Minor | 4.1.2 | `frontend/src/components/team/FullStandings.jsx:298-303` | `SortIcon` uses `▲ ▼ ⇅` text characters with `aria-hidden="true"` — good, `aria-sort` handles the state announcement (line 351). | OK — good pattern. |
| 88 | Minor | 1.1.1 | multiple | `frontend/src/index.html` only sets `<link rel="icon">` — missing `<link rel="alternate">` or `<meta name="description">`. Not strict WCAG but SEO/a11y. | Add meta description. |
| 89 | Minor | 1.3.1 | `frontend/src/components/ballflight3d/BallFlight3DDemo.jsx:202-206` | Heading hierarchy: h2 "3D Ball Flight Viewer", then h3 "Sample Hits" / "Custom Hit Builder" — OK. But no h1 on the route — team-name h1 in TopBar is the only h1. | Promote page title to h1 within `<main>`. |
| 90 | Minor | 2.4.4 | `frontend/src/components/team/Scoreboard.jsx:905,914,923` | "W:", "L:", "SV:" decision labels are sibling text of player-link spans. The span with onClick has no role/tabindex. | Fix as part of #10. Make each W/L/SV into an accessible button. |

---

## Per-Area Findings

### Layout / Shell (`AppShell.jsx`, `TopBar.jsx`, `TopTabs.jsx`)

**Positives:** `<main>` element used. `<html lang="en">` set. Reduced-motion media query honored globally. Focus returns to main on route change. Title updates per route.

**Issues:**
- No skip-link (**#21**).
- Search overlay missing focus trap, focus-return on close, and `aria-modal` (**#20**).
- TopTabs is a nav — may or may not be appropriate; class naming implies tabs. If tabs, refactor to APG tabs (**#26**).
- Icon buttons in TopBar all have good `aria-label` — **confirmed OK** for search, edge, stats, switch, back (lines 155-201).
- Title hierarchy: team name is h1 in TopBar on every page, which conflicts with per-route h1 (**#29-31**).
- Pull-to-refresh SVG missing `aria-hidden` (**#81**).

### Team Dashboard (`TeamDashboard.jsx`, `TodayGame.jsx`, `UpcomingSeries.jsx`, `StandingsCard.jsx`, `TeamHotCold.jsx`, `LeagueLeaders.jsx`, `TransactionFeed.jsx`)

**Positives:** `StandingsCard` has a proper table with `<caption>`, `scope="col"`, `<abbr>` headers, and `aria-current` on my-team row — **this is the gold standard in the app**. `TeamHotCold` uses real `<button>` for rows — good. `TransactionFeed` is read-only and clean.

**Issues:**
- `TodayGame` is a minefield of nested interactives — card onClick + inner team buttons + inner pitcher divs (**#1-3**).
- `UpcomingSeries` pitcher name is a clickable span (**#15**).
- `LeagueLeaders` rows are clickable divs (**#14**).
- `StandingsCard`'s `<tr>` onClick pattern is a regression from its own internal table accessibility — fix at the row level (**#12**).

### Player Detail (`PlayerDetail.jsx`, `BatterStats.jsx`, `PitcherStats.jsx`, `AdvancedBatterStats.jsx`, `PlayerGameLog.jsx`, `PitchArsenal.jsx`, `DominanceProfile.jsx`, `ContractCard.jsx`)

**Positives:** `AdvancedBatterStats` percentile tiles use `<button>` + `aria-pressed` + `aria-label` with numeric value (**great, line 164-171**). Game log table has `<abbr>` headers. Player name is h2 (should be h1 on route, see #29).

**Issues:**
- Season selects lack labels (**#50**).
- Game log / Arsenal / Contract tables missing `scope="col"` (**#47-48**).
- Percentile bars `aria-hidden` is correct — color info is redundant with text.

### Matchup (`MatchupView.jsx`, `BatterVsPitcher.jsx`, `ParkHistory.jsx`, `PriorMatchups.jsx`, `WinProbability.jsx`)

**Positives:** Win-probability SVG has a good `aria-label`. ParkHistory / PriorMatchups are read-only and clean. Matchup team logos are `<button>` links with labels.

**Issues:**
- `CollapsibleSection` is the single biggest regression — 10+ collapsibles silent to SRs (**#7**).
- Lineup rows, hot/cold rows, bullpen rows, edge rows, injury rows all use `div onClick` (**#5-6, #16**).
- `GameSwitcher` dropdown missing ARIA (**#27-28**).
- No h1 on Matchup route (**#30**).
- `matchup-preview-title` is styled h2 but a plain div (**#52**).
- `WinProbability` axis text contrast borderline (**#33**).

### Spray Chart (`SprayChart.jsx`, `BallparkSVG.jsx`, `HitDots.jsx`, `SprayLegend.jsx`, `SpraySidebar.jsx`)

**Positives:** Selects have `aria-label`. Legend buttons have `aria-pressed` + `aria-label`. BallparkSVG has role="img" + aria-label.

**Issues:**
- Hit dots are the canonical "non-keyboard-accessible SVG click-target" bug (**#17**).
- Color-only differentiation of hit types (**#36**).
- No tabular alternative for the 100s of hits in a career view.
- Star shape for longest HR is good precedent — use more shape-based encoding.

### Strike Zone (`StrikeZoneSVG.jsx`, `MissedCallDots.jsx`, `MissedCallHeatmap.jsx`, `MissedCallsPanel.jsx`)

**Issues:**
- Missed-call dots — same bug as spray chart (**#18**).
- Toggle groups (dots/heatmap, all/squeezed/gifted) missing tab ARIA (**#23**).
- Color-only encoding of squeezed vs gifted (**#35**).

### 3D Ball Flight (`BallFlight3DDemo.jsx`, `BallInPlay3D.jsx`, and related)

**Issues — the most accessibility-hostile feature:**
- Canvas has zero accessible name, no text alternative (**#19**).
- Auto-plays animation with no pause/stop (**#19**).
- Does not check `prefers-reduced-motion` within the component — global CSS reducer can't stop the `requestAnimationFrame`-driven Three.js animations (**#19**).
- Demo page range inputs are inside `<label>` but label text is not programmatically tied (**#42**).
- 1B/2B/3B toggle buttons miss group role + `aria-pressed` (**#43**).
- No live-region announcement of outcome/metrics (**#56**).
- Emoji in "Launch Ball" button not hidden (**#54**).
- No h1 on route (**#89**).

### Schedule (`ScheduleView.jsx`)

**Issues:**
- Every game row is `<div onClick>` (**#8**). Month-pill buttons are real `<button>` — good.
- No h1 on route.
- Months filter group could use `role="group" aria-label="Filter by month"`.

### Scoreboard / Live Game (`Scoreboard.jsx`, `LiveGamePage.jsx`)

**Issues:**
- Widespread `sb-player-link` div/span pattern (**#10**). Many variants — some have `role="link" tabIndex={0}` but NO keyboard handler (lines 86-89, 346, 542, 556), which is actively misleading — SR announces "link" but Enter does nothing.
- Box-score rows are DIV "tables" (**#49**).
- Linescore `<th>` lacks `scope` (**#46**).
- Score changes not announced (**#57**).
- Watch/Gameday buttons should be links (**#51**).
- No h1 (**#53**).
- `GameDetail` internal tabs miss ARIA (**#25**).
- Live diamond SVG has no accessible name (**#79**).
- LiveGamePage uses `dangerouslySetInnerHTML` pattern (**#45**).

### Forms / Inputs

Selects: TeamSelector search (**#77**), TopBar search (**#76**), spray chart selects — most have `aria-label` or wrap in label. Season selects in BatterStats/PitcherStats lack label (**#50**). Year filter in MissedCallsPanel has `aria-label` — good. Checkbox in BettingEdge wraps label text (**#66**) — acceptable but fragile.

No forms in the traditional sense (no multi-field submission). Error messages use `role="alert" aria-live="assertive"` (**ErrorMessage.jsx:3**) — good.

### Color System (`theme/teamThemes.js`, custom CSS variables)

The team theme defines `primary`, `secondary`, `accent` per team. The `index.css` derives CSS variables from these on the `<html>` element. White text on team-primary colors is generally safe for MLB palettes (all navy/red/green tones have low luminance). Specific concerns:

- **Mariners** (`#0C2C56` primary, `#005C5C` secondary, `#C4CED4` accent): white on #0C2C56 = 15.8:1 ✓. White on #005C5C = 7.3:1 ✓. Accent #C4CED4 is a silver/teal, low contrast on white bg. Only used sparingly (focus outline, borders) — OK.
- **Braves** (`#13274F` primary, `#CE1141` red, `#EAAA00` gold): white on #13274F = 15.2:1 ✓. White on #CE1141 = 4.64:1 just barely ✓. #EAAA00 gold on white/dark bg — pale yellow on dark bg OK, but gold text on white surface (if used) fails. I don't see #EAAA00 used as text on light in the code, so safe.
- Edge / Stats-Lab buttons use hardcoded `#22c55e` / `#62a0ff` — the green is ~3.6:1 on the navy shell, below 4.5:1 text threshold (the icons are non-text so 3:1 applies and is met — OK) (**#32**).
- `var(--text-muted): #a3aabe` on `var(--bg): #0a0e17` ≈ 8.1:1 ✓. On `var(--bg-card): #141a28` ≈ 6.7:1 ✓.
- `#9299ad` used in WinProbability SVG text on `#0d1117` ≈ 4.9:1 — borderline, fine for labels but not for crucial text (**#33**).
- `win-text` green and `loss-text` red — unknown exact shades, but used only with "W"/"L" text, so color-only is avoided.
- Bullpen dots: `.bullpen-status-dot.limited` `#F59E0B`, `.available` and `.unavailable` colors — legend text accompanies them, redundant encoding OK.

Overall the color system is sound. The weak spots are small icon buttons on varying team primaries (**#32**) and the 8px SVG axis text (**#33**).

---

## Quick Wins (<30 min each)

1. **Add skip link** (`App.jsx`, `AppShell.jsx`):
   ```jsx
   <a href="#main-content" className="sr-only sr-only-focusable skip-link">
     Skip to main content
   </a>
   ...
   <main id="main-content" ...>
   ```
   Add CSS for `.sr-only-focusable:focus-visible { position: absolute; top: 8px; left: 8px; padding: 8px 12px; background: #000; color: #fff; z-index: 999; }`. (#21)

2. **Add `aria-label` to season selects** (`BatterStats.jsx:33`, `PitcherStats.jsx:29`):
   ```jsx
   <select className="stat-season-select" aria-label="Select season" ...>
   ```
   (#50)

3. **Add `aria-modal` and focus-return to search overlay** (`TopBar.jsx:209, 49-54`):
   ```jsx
   const triggerRef = useRef(null);
   const openSearch = () => { triggerRef.current = document.activeElement; /* ... */ };
   const closeSearch = () => { /* ... */ triggerRef.current?.focus(); };
   <div className="player-search-overlay" role="dialog" aria-modal="true" aria-label="Search players" ...>
   ```
   (#20)

4. **Make `CollapsibleSection` accessible** (`MatchupView.jsx:875-888`):
   ```jsx
   function CollapsibleSection({ title, children, defaultOpen = true }) {
     const [open, setOpen] = useState(defaultOpen);
     const id = useId();
     return (
       <div className="matchup-section collapsible-section">
         <button
           type="button"
           className="collapsible-header"
           aria-expanded={open}
           aria-controls={`panel-${id}`}
           onClick={() => setOpen(!open)}
         >
           <h3>{title}</h3>
           <svg aria-hidden="true" ...>...</svg>
         </button>
         <div id={`panel-${id}`} role="region" hidden={!open}>
           {children}
         </div>
       </div>
     );
   }
   ```
   (#7)

5. **Add `type="button"` + `role="alert"` to ErrorBoundary** (`ErrorBoundary.jsx:14-25`):
   ```jsx
   <div role="alert" style={...}>
     <p>Something went wrong loading this page.</p>
     <button type="button" ...>Try again</button>
   </div>
   ```
   (#64)

6. **Add `scope="col"` to arsenal / contract / linescore tables** (`PitchArsenal.jsx:86-93`, `ContractCard.jsx:107-109`, `Scoreboard.jsx:182-189`):
   ```jsx
   <th scope="col">Pitch</th>
   ```
   (#46-48)

7. **Mark scorebord `ScoreDisplay` as live** (`Scoreboard.jsx:308`):
   ```jsx
   return <span className="scoreboard-score ..." aria-live="polite" aria-atomic="true">{value}</span>;
   ```
   (#57)

8. **Hide decorative emoji** (`BallFlight3DDemo.jsx:309`):
   ```jsx
   <span aria-hidden="true">🔥</span> Launch Ball
   ```
   (#54)

9. **Set `alt=""` on redundant team logos** (`TodayGame.jsx:64,80,153,174` and similar). The abbreviation text immediately follows. (#61)

10. **Wrap Runners-On buttons in `role="group"`** (`BallFlight3DDemo.jsx:295-305`):
    ```jsx
    <div role="group" aria-label="Runners on base" className="bip3d-runner-toggles">
      {["first","second","third"].map(base => (
        <button
          key={base}
          aria-pressed={customRunners[base]}
          ...
        >
          {base === "first" ? "1B" : base === "second" ? "2B" : "3B"}
        </button>
      ))}
    </div>
    ```
    (#43)

11. **Replace Watch button with real link** (`TodayGame.jsx:223-236`, `Scoreboard.jsx:934`):
    ```jsx
    <a className="today-game-watch" href={`https://www.mlb.com/tv/g${game.gamePk}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
      <svg aria-hidden="true" ...>...</svg>
      Watch <span className="sr-only">(opens in new tab)</span>
    </a>
    ```
    (#51, #39)

12. **Add `<caption className="sr-only">` to tables missing one** (arsenal, contract, linescore, gamelog — note gamelog `<table>` has no caption). (#46-49)

13. **Add `aria-label="Main content"` to `<main>`** (`AppShell.jsx:112`). (#59)

14. **Use `type="search"` on search inputs** (`TopBar.jsx:219`, `TeamSelector.jsx:36-42`). (#72)

15. **Add `aria-pressed` to segmented-control buttons**: Hitting/Pitching (`LeagueLeaders.jsx:46-47`), Dots/Heatmap + All/Squeezed/Gifted (`MissedCallsPanel.jsx:61-88`), Scoring/Box Score (`Scoreboard.jsx:456-457`). (#23-25)

---

## Larger Remediation Items

These require design, architecture, or significant refactoring:

### A. Eliminate `<div onClick>` / `<span onClick>` row pattern

**Scope:** 25+ call sites across Scoreboard, Matchup, Schedule, StandingsCard, LeagueLeaders, TeamHotCold (some), UpcomingSeries, BatterVsPitcher, LiveGamePage.

**Approach:** Create a reusable `<TappableRow as="button|Link" ...>` primitive in `frontend/src/components/common/` that:
- Renders `<Link>` when navigating within the SPA, `<button>` for in-page toggles.
- Applies the existing `.sb-player-link` / `.sb-tappable` visual styles (currently a `display:flex` row) via `button { all: unset; }`-style reset + className.
- Handles `onKeyDown` for role-button scenarios.
- Forbids nested interactives via a React context provider that warns when a child tappable is rendered inside another.

Mass-replace existing `div.sb-player-link onClick={() => navigate(...)}` → `<TappableRow to="..." onClick>`.

**Addresses:** #1-6, #8, #10-16, #49 (partially).

### B. Data-viz text alternatives

**Scope:** Spray chart, strike zone, 3D ball flight, win probability.

**Approach:** Below each chart, render a collapsible `<details><summary>Data table</summary><table>...</table></details>`. For spray chart, it's the list of hits (already rendered as dots, just needs tabular form). For missed calls, a table of (date, pitch type, velo, count, squeezed/gifted). For win probability, tabular play-by-play with prob added. For 3D ball flight, a summary recap ("Home Run, 112.4 mph, 425 ft, bases loaded, 4 runs scored") in an `aria-live="polite"` region that updates after each replay.

Add keyboard operability to SVG dots: render each dot with `tabIndex="0" role="button" aria-label={describe(hit)}` and an `onKeyDown` that triggers the same select handler. Focus style via `.hit-dot:focus-visible { outline: 1px solid #fff; }` inside the SVG.

**Addresses:** #17-19, #35-36, #69-71.

### C. 3D animation reduced-motion + accessibility controls

`BallInPlay3D.jsx` needs:
- `useReducedMotion()` hook (from framer-motion or custom `matchMedia('(prefers-reduced-motion: reduce)')`) — when true, skip animation, render a static top-down diagram of the hit location + metrics overlay immediately.
- Play / Pause / Replay button toolbar above the canvas. Replay button exists but is buried in the component. Extract to the metrics overlay and expose as a toolbar with `role="toolbar" aria-label="Ball flight controls"`.
- `role="application" aria-label={describeHit(hitData)}` on the Canvas wrapper, so SR users hear a summary when entering the region.
- Sibling `aria-live="polite"` region outputting phase-by-phase narration: "Pitch thrown. Contact made. Ball in air. Ball lands in deep center. Runner scores from second. Runner scores from third. Batter safe at second. Double."

**Addresses:** #19, #56.

### D. Full WAI-ARIA tabs refactor

Create a `<Tabs>` / `<Tab>` / `<TabPanel>` primitive implementing the APG pattern. Apply to FullStandings, MissedCallsPanel, LeagueLeaders, Scoreboard `GameDetail`, and (if intended) TopTabs.

**Addresses:** #22-26.

### E. Heading hierarchy rationalization

Move team-name `<h1>` out of TopBar (demote to a styled `<span>`). Each route component provides its own `<h1>` inside `<main>`. Update sub-components to use h2/h3 consistently.

**Addresses:** #29-31, #53, #89.

### F. Touch-target audit and sweep

Measure every interactive element against 2.5.8 (24×24) and ideally 2.5.5 (44×44). Likely culprits: `.top-tab`, `.month-pill`, `.sb-expand-hint`, search overlay close, pitcher line items, legend dots.

**Addresses:** #40.

### G. Focus-trap and dialog primitive

Introduce a `<Dialog>` component using native `<dialog showModal()>` or a proven library (`@radix-ui/react-dialog`). Use for search overlay, any future modals. Gives focus trap, return focus, Esc handling for free.

**Addresses:** #20.

---

## Testing Recommendations

### Screen Reader Testing

**Critical journeys to test** with VoiceOver (macOS Safari) and NVDA (Windows Firefox/Chrome):
1. Land on Team Selector → pick Mariners → arrive at dashboard. Verify team-name announcement, landmark enumeration, heading navigation (`H` key).
2. From dashboard, navigate to Today's Game → open matchup. Expected FAILURES: team-name logos, lineup rows, collapsible sections.
3. Open Scoreboard → find a live game → attempt to hear score updates (won't work without live-region fix).
4. Open a player detail page → navigate stats table. Expected OK: standings table, game log. Expected fail: missed calls dots.
5. Open Spray Chart → select a player → attempt to hear individual hit stats (will fail — no text alternative).
6. Open 3D Ball Flight Demo → what is announced? (Currently nothing meaningful.)
7. Open search overlay → Tab through → Esc to close → verify focus returns to search button (currently doesn't).

### Keyboard-Only Testing

1. Tab through the team-dashboard homepage and count how many "stops" are on non-operable elements (divs marked role=link without key handlers). Every `sb-player-link` span with tabIndex=0 but no key handler is a dead stop.
2. Try to complete a full path: Team selector → team dashboard → today's game card → matchup view → lineups → click a player. With no mouse. Expect failures around the card/lineups.
3. Schedule view — Tab to a schedule row. Will not receive focus because it's a div.
4. Standings table — Tab to a row. Row is clickable but not focusable.
5. Matchup collapsible sections — no way to expand/collapse via keyboard.
6. 3D ball flight demo — presets are real buttons; range sliders are OK; Launch button works; replay button only appears after animation completes; no way to stop animation mid-flight.

### Automated Tooling

1. **axe-core** via `@axe-core/cli` against `http://localhost:5173` for each primary route. Expect 30+ issues flagged.
2. **Lighthouse Accessibility** score baseline. Re-run after each remediation milestone.
3. **eslint-plugin-jsx-a11y** in the project ESLint config — add rules:
   ```json
   "plugin:jsx-a11y/recommended"
   ```
   This will catch most `<div onClick>` / missing alt / redundant ARIA at lint time.
4. **jest-axe** for component-level regression tests. Add a test per component that rejects known-bad patterns.
5. **Playwright + axe** for route-level scans in CI.

### Manual Visual

- Zoom to 200% and 400% browser zoom. Verify no horizontal scroll, no content clipping, all text readable. The mobile-first 16px base should work; confirm nothing uses fixed `overflow:hidden` containers that lose content.
- Enable `prefers-reduced-motion` in OS → verify Ball Flight 3D still plays (it will — known gap). Verify live-dot-flash and jumbo-glow animations stop (they should — global rule).
- Enable macOS "Increase contrast" / Windows "High Contrast" mode → verify every interactive element remains visible. The dark theme + weak focus outlines are especially vulnerable.
- Test on iOS Safari with VoiceOver swiping through; test on Android Chrome with TalkBack.

---

## Summary Counts

- **Critical:** 21 issues (#1-21)
- **Serious:** 24 issues (#22-45)
- **Moderate:** 30 issues (#46-75)
- **Minor:** 15 issues (#76-90)
- **Explicitly confirmed OK:** `ErrorMessage` live region, `LoadingSpinner` status region, `StandingsCard` table semantics, `PlayerPhoto` fallback role/label, `SortIcon` `aria-hidden`+`aria-sort`, global `prefers-reduced-motion` rule, edge back button aria-label, reduced-motion edge animations.

Re-audit after Quick Wins + Larger Item A + B should drop Critical count to ~3 and Serious to ~10.
