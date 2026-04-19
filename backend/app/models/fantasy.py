"""Pydantic response models for the Fantasy projections endpoint."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class OppPitcher(BaseModel):
    id: Optional[int] = None
    fullName: Optional[str] = None


class ParkInfo(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None
    runs: Optional[int] = None
    hr: Optional[int] = None
    label: Optional[str] = None


class Weather(BaseModel):
    temp: Optional[float | str] = None
    condition: Optional[str] = None
    wind: Optional[str] = None


class PerEvent(BaseModel):
    singles: float
    doubles: float
    triples: float
    home_runs: float
    bb_hbp: float
    r: float
    rbi: float
    sb: float


class Multipliers(BaseModel):
    park_hr: float
    park_runs: float
    weather_hr: float
    pitcher_hits: Optional[float] = 1.0   # opposing pitcher hit-suppression
    pitcher_hr:   Optional[float] = 1.0   # opposing pitcher HR-suppression
    slot_r:       Optional[float] = 1.0   # lineup-slot R-opportunity adj
    slot_rbi:     Optional[float] = 1.0   # lineup-slot RBI-opportunity adj
    team_env_r:   Optional[float] = 1.0   # batter's team offensive env (R)
    team_env_rbi: Optional[float] = 1.0   # batter's team offensive env (RBI)
    # Tier 1 — Statcast expected + K-damper
    stx_xwoba:    Optional[float] = 1.0   # xwOBA regression on non-HR hits
    stx_barrel:   Optional[float] = 1.0   # barrel% regression on HRs
    stx_hardhit:  Optional[float] = 1.0   # hard-hit% regression on non-HR hits
    pitcher_gb_hr: Optional[float] = 1.0  # pitcher GB% suppression on HR
    k_damper:     Optional[float] = 1.0   # combined K-product damper on all rates


class Rates(BaseModel):
    singles: float
    doubles: float
    triples: float
    home_runs: float
    bb_hbp: float
    r_per_pa: float
    rbi_per_pa: float


class PrizePicksLines(BaseModel):
    """Matched PrizePicks over/under lines by stat type."""
    fantasy: Optional[float] = None      # Hitter Fantasy Score (direct EFP compare)
    hits: Optional[float] = None
    hrr: Optional[float] = None           # Hits + Runs + RBIs
    total_bases: Optional[float] = None
    home_runs: Optional[float] = None
    rbis: Optional[float] = None
    runs: Optional[float] = None
    walks: Optional[float] = None
    singles: Optional[float] = None
    doubles: Optional[float] = None
    stolen_bases: Optional[float] = None
    strikeouts: Optional[float] = None


class ProjectionRow(BaseModel):
    player_id: int
    name: str
    position: Optional[str] = None
    bat_side: Optional[str] = None  # "L", "R", "S", or None (unknown)
    team_id: int
    team_abbr: str
    opp_team_id: Optional[int] = None
    opp_abbr: Optional[str] = None
    opp_pitcher: Optional[OppPitcher] = None
    park: ParkInfo
    weather: Optional[Weather] = None
    pa: float
    pa_source: str
    efp: float
    tier: str
    per_event: PerEvent
    multipliers: Multipliers
    rates: Rates
    prizepicks: Optional[PrizePicksLines] = None
    edge_fantasy: Optional[float] = None   # efp minus PP Hitter Fantasy Score line


class Metrics(BaseModel):
    r2: Optional[float] = None
    mae: Optional[float] = None
    spearman: Optional[float] = None
    n: int = 0


class ProjectionResponse(BaseModel):
    date: str
    season: int
    weights_version: Optional[str] = None
    calibrated: bool = False
    metrics: Metrics = Metrics()
    game_count: int
    projection_count: int
    projections: list[ProjectionRow]
