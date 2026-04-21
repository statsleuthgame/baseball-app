"""DEPRECATED — FanGraphs leaderboards are Cloudflare-blocked.

pybaseball's legacy endpoint returns 403, and the public JSON API
(`/api/leaders/major-league/data`) is behind Cloudflare's managed JS
challenge, so curl_cffi + browser-fingerprint headers aren't enough.

This is intentionally a no-op in the main pipeline. Every FanGraphs
leaderboard stat (wOBA, wRC+, FIP, xFIP, SIERA, ISO, BABIP, plate
discipline, pitch-type run values) is derivable from Statcast + Lahman,
which we already pull. Only fWAR is genuinely proprietary; if we need it,
implement a Playwright scraper that solves the JS challenge.
"""

from __future__ import annotations


def pull_all(start_year: int = 2000, force: bool = False) -> None:
    print("fangraphs: skipped (Cloudflare-blocked; see module docstring)")


def main() -> None:
    pull_all()


if __name__ == "__main__":
    main()
