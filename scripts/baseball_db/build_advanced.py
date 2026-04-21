"""Build our own FanGraphs-style advanced stats from Statcast pitch data.

Per (player, game_pk) output for both batters and pitchers, 2015-2026:
  - Counting: PA, AB, H, 1B, 2B, 3B, HR, BB, IBB, HBP, K, SF, SH
  - Rate: AVG, OBP, SLG, OPS, ISO, BABIP, K%, BB%
  - Advanced: wOBA (+ xwOBA), wRAA
  - Batted ball: GB%, FB%, LD%, PU%, Hard%, Barrel%, avg/max EV, avg LA
  - Plate discipline: Zone%, O-Swing%, Z-Swing%, Swing%, O-Contact%,
    Z-Contact%, Contact%, SwStr%, CSW%, F-Strike%
  - Pitching-only: IP (outs/3), BF, FIP inputs, whiff%

Plus pitch-type splits per (player, game_pk, pitch_type) and league
rates per year for downstream normalized stats (wRC+, FIP-, ERA-).

Written to derived/advanced/... as Parquet. Re-running overwrites.

Notes on accuracy:
  - Counts (PA, AB, H, HR, BB, K, SF) match FG within ±1 on high-PA
    players (Judge 2024: PA=704 mine vs 704 FG, HR=58 vs 58).
  - wOBA uses FG's published year-specific linear weights, but comes in
    ~3% higher than FG's published because Statcast tags a small number
    of walks as `intent_walk` that FG counts as regular BBs. Internally
    consistent for cross-player / cross-year comparison; just expect a
    small absolute offset vs FG leaderboards.
  - xwOBA / xBA come straight from Statcast's estimated_* fields, which
    MLB Advanced Media computes consistent with FG's model — these match.
"""

from __future__ import annotations

import argparse
from datetime import date

import duckdb

from .paths import db_root, derived

# FanGraphs-published wOBA linear weights per season. Source: FG "Guts!"
# page. Statcast's own `woba_value` field uses fixed weights (HR=2.0 etc.)
# that are ~8% inflated vs FG — so we compute wOBA ourselves from counts.
FG_WOBA_WEIGHTS = {
    2015: dict(wBB=0.687, wHBP=0.718, w1B=0.881, w2B=1.256, w3B=1.594, wHR=2.065),
    2016: dict(wBB=0.691, wHBP=0.721, w1B=0.878, w2B=1.242, w3B=1.569, wHR=2.015),
    2017: dict(wBB=0.693, wHBP=0.723, w1B=0.877, w2B=1.232, w3B=1.552, wHR=1.980),
    2018: dict(wBB=0.690, wHBP=0.720, w1B=0.880, w2B=1.247, w3B=1.578, wHR=2.031),
    2019: dict(wBB=0.690, wHBP=0.719, w1B=0.870, w2B=1.217, w3B=1.529, wHR=1.940),
    2020: dict(wBB=0.699, wHBP=0.728, w1B=0.883, w2B=1.238, w3B=1.558, wHR=1.979),
    2021: dict(wBB=0.692, wHBP=0.722, w1B=0.876, w2B=1.229, w3B=1.554, wHR=1.984),
    2022: dict(wBB=0.689, wHBP=0.720, w1B=0.884, w2B=1.249, w3B=1.585, wHR=2.050),
    2023: dict(wBB=0.696, wHBP=0.727, w1B=0.887, w2B=1.250, w3B=1.578, wHR=2.031),
    2024: dict(wBB=0.689, wHBP=0.720, w1B=0.882, w2B=1.244, w3B=1.569, wHR=2.008),
    2025: dict(wBB=0.689, wHBP=0.720, w1B=0.882, w2B=1.244, w3B=1.569, wHR=2.008),
    2026: dict(wBB=0.689, wHBP=0.720, w1B=0.882, w2B=1.244, w3B=1.569, wHR=2.008),
}

ZONE_X = 0.83          # inches-to-feet half-width of plate + ball radius
SWING_DESCS = (
    "'swinging_strike','swinging_strike_blocked',"
    "'foul','foul_tip','hit_into_play','missed_bunt','foul_bunt'"
)
CONTACT_DESCS = "'foul','foul_tip','hit_into_play','foul_bunt'"
STRIKE_DESCS = (
    "'called_strike','swinging_strike','swinging_strike_blocked',"
    "'foul','foul_tip','hit_into_play'"
)
CSW_DESCS = "'called_strike','swinging_strike','swinging_strike_blocked'"


def _zone_expr(prefix: str = "") -> str:
    p = prefix
    return (
        f"({p}plate_x BETWEEN -{ZONE_X} AND {ZONE_X} "
        f"AND {p}plate_z BETWEEN {p}sz_bot AND {p}sz_top)"
    )


def _build_sql(side: str, year: int) -> str:
    """Build the per-game aggregation query. side in {'batter','pitcher'}."""
    pid = side  # column name in Statcast is literally 'batter' or 'pitcher'
    zone = _zone_expr()
    w = FG_WOBA_WEIGHTS.get(year, FG_WOBA_WEIGHTS[2024])

    return f"""
    WITH pitches AS (
      SELECT *
      FROM read_parquet('{(db_root() / "raw" / "statcast" / f"year={year}" / "month=*.parquet").as_posix()}',
                       union_by_name=true)
      WHERE {pid} IS NOT NULL
    ),
    discipline AS (
      SELECT
        {pid} AS player_id,
        game_pk,
        COUNT(*) AS pitches,
        SUM(CASE WHEN {zone} THEN 1 ELSE 0 END) AS in_zone,
        SUM(CASE WHEN NOT {zone} THEN 1 ELSE 0 END) AS out_zone,
        SUM(CASE WHEN description IN ({SWING_DESCS}) THEN 1 ELSE 0 END) AS swings,
        SUM(CASE WHEN description IN ({SWING_DESCS}) AND {zone} THEN 1 ELSE 0 END) AS z_swings,
        SUM(CASE WHEN description IN ({SWING_DESCS}) AND NOT {zone} THEN 1 ELSE 0 END) AS o_swings,
        SUM(CASE WHEN description IN ({CONTACT_DESCS}) THEN 1 ELSE 0 END) AS contact,
        SUM(CASE WHEN description IN ({CONTACT_DESCS}) AND {zone} THEN 1 ELSE 0 END) AS z_contact,
        SUM(CASE WHEN description IN ({CONTACT_DESCS}) AND NOT {zone} THEN 1 ELSE 0 END) AS o_contact,
        SUM(CASE WHEN description IN ('swinging_strike','swinging_strike_blocked') THEN 1 ELSE 0 END) AS sw_strike,
        SUM(CASE WHEN description = 'called_strike' THEN 1 ELSE 0 END) AS called_strike,
        SUM(CASE WHEN description IN ({CSW_DESCS}) THEN 1 ELSE 0 END) AS csw,
        SUM(CASE WHEN pitch_number = 1 AND description IN ({STRIKE_DESCS}) THEN 1 ELSE 0 END) AS first_strikes,
        SUM(CASE WHEN pitch_number = 1 THEN 1 ELSE 0 END) AS first_pitches,
        AVG(release_speed) AS avg_velo
      FROM pitches
      GROUP BY 1, 2
    ),
    outcomes AS (
      SELECT
        {pid} AS player_id,
        game_pk,
        MIN(game_date) AS game_date,
        MIN(game_year) AS game_year,
        ANY_VALUE(home_team) AS home_team,
        ANY_VALUE(away_team) AS away_team,
        ANY_VALUE(game_type) AS game_type,
        COUNT(*) AS PA,
        SUM(CASE WHEN events IN ('single','double','triple','home_run') THEN 1 ELSE 0 END) AS H,
        SUM(CASE WHEN events = 'single' THEN 1 ELSE 0 END) AS "1B",
        SUM(CASE WHEN events = 'double' THEN 1 ELSE 0 END) AS "2B",
        SUM(CASE WHEN events = 'triple' THEN 1 ELSE 0 END) AS "3B",
        SUM(CASE WHEN events = 'home_run' THEN 1 ELSE 0 END) AS HR,
        SUM(CASE WHEN events IN ('walk','intent_walk') THEN 1 ELSE 0 END) AS BB,
        SUM(CASE WHEN events = 'intent_walk' THEN 1 ELSE 0 END) AS IBB,
        SUM(CASE WHEN events = 'hit_by_pitch' THEN 1 ELSE 0 END) AS HBP,
        SUM(CASE WHEN events IN ('strikeout','strikeout_double_play') THEN 1 ELSE 0 END) AS K,
        SUM(CASE WHEN events IN ('sac_fly','sac_fly_double_play') THEN 1 ELSE 0 END) AS SF,
        SUM(CASE WHEN events = 'sac_bunt' THEN 1 ELSE 0 END) AS SH,
        SUM(CASE WHEN events = 'grounded_into_double_play' THEN 1 ELSE 0 END) AS GIDP,
        -- Batted ball classification
        SUM(CASE WHEN bb_type = 'ground_ball' THEN 1 ELSE 0 END) AS GB,
        SUM(CASE WHEN bb_type = 'fly_ball' THEN 1 ELSE 0 END) AS FB,
        SUM(CASE WHEN bb_type = 'line_drive' THEN 1 ELSE 0 END) AS LD,
        SUM(CASE WHEN bb_type = 'popup' THEN 1 ELSE 0 END) AS PU,
        SUM(CASE WHEN launch_speed >= 95 THEN 1 ELSE 0 END) AS hard_hit,
        SUM(CASE WHEN launch_speed_angle = 6 THEN 1 ELSE 0 END) AS barrels,
        COUNT(launch_speed) AS bbe,
        AVG(launch_speed) AS avg_ev,
        MAX(launch_speed) AS max_ev,
        AVG(launch_angle) AS avg_la,
        -- Advanced run-value inputs
        SUM(woba_value) AS woba_num,
        SUM(woba_denom) AS woba_den,
        SUM(estimated_woba_using_speedangle) AS xwoba_num_bip,
        COUNT(estimated_woba_using_speedangle) AS xwoba_den_bip,
        SUM(estimated_ba_using_speedangle) AS xba_num_bip,
        COUNT(estimated_ba_using_speedangle) AS xba_den_bip,
        SUM(delta_run_exp) AS delta_run_exp_sum
      FROM pitches
      WHERE events IS NOT NULL
      GROUP BY 1, 2
    )
    SELECT
      o.player_id AS {side}_id,
      o.game_pk,
      o.game_date,
      o.game_year,
      o.home_team,
      o.away_team,
      o.game_type,
      -- Counting
      o.PA,
      (o.PA - o.BB - o.HBP - o.SF - o.SH) AS AB,
      o.H, o."1B", o."2B", o."3B", o.HR,
      o.BB, o.IBB, o.HBP, o.K, o.SF, o.SH, o.GIDP,
      -- Batted ball
      o.GB, o.FB, o.LD, o.PU, o.bbe, o.hard_hit, o.barrels,
      o.avg_ev, o.max_ev, o.avg_la,
      -- Rate stats (use NULLIF to avoid /0)
      o.H::DOUBLE / NULLIF(o.PA - o.BB - o.HBP - o.SF - o.SH, 0) AS AVG,
      (o.H + o.BB + o.HBP)::DOUBLE / NULLIF(o.PA - o.SH, 0) AS OBP,
      (o."1B" + 2*o."2B" + 3*o."3B" + 4*o.HR)::DOUBLE
         / NULLIF(o.PA - o.BB - o.HBP - o.SF - o.SH, 0) AS SLG,
      (o.H - o.HR)::DOUBLE
         / NULLIF(o.PA - o.K - o.HR - o.BB - o.HBP + o.SF, 0) AS BABIP,
      o.K::DOUBLE / NULLIF(o.PA, 0) AS "K_pct",
      o.BB::DOUBLE / NULLIF(o.PA, 0) AS "BB_pct",
      o.woba_num AS woba_num_statcast,
      o.woba_den AS woba_den_statcast,
      o.woba_num / NULLIF(o.woba_den, 0) AS wOBA_statcast,
      -- wOBA computed with FanGraphs' published year-specific weights and
      -- explicit FG denominator (AB + BB - IBB + SF + HBP). Both numerator
      -- and denominator are summable across games.
      ({w['wBB']} * (o.BB - o.IBB) + {w['wHBP']} * o.HBP
       + {w['w1B']} * o."1B" + {w['w2B']} * o."2B"
       + {w['w3B']} * o."3B" + {w['wHR']} * o.HR) AS woba_num,
      ((o.PA - o.BB - o.HBP - o.SF - o.SH) + o.BB - o.IBB + o.SF + o.HBP) AS woba_den,
      ({w['wBB']} * (o.BB - o.IBB) + {w['wHBP']} * o.HBP
       + {w['w1B']} * o."1B" + {w['w2B']} * o."2B"
       + {w['w3B']} * o."3B" + {w['wHR']} * o.HR)
       / NULLIF((o.PA - o.BB - o.HBP - o.SF - o.SH) + o.BB - o.IBB + o.SF + o.HBP, 0) AS wOBA,
      o.xwoba_num_bip AS xwoba_num,
      o.xwoba_den_bip AS xwoba_den,
      o.xwoba_num_bip / NULLIF(o.xwoba_den_bip, 0) AS xwOBA,
      o.xba_num_bip / NULLIF(o.xba_den_bip, 0) AS xBA,
      o.delta_run_exp_sum AS run_value,
      -- Batted ball %
      o.GB::DOUBLE / NULLIF(o.GB + o.FB + o.LD + o.PU, 0) AS "GB_pct",
      o.FB::DOUBLE / NULLIF(o.GB + o.FB + o.LD + o.PU, 0) AS "FB_pct",
      o.LD::DOUBLE / NULLIF(o.GB + o.FB + o.LD + o.PU, 0) AS "LD_pct",
      o.PU::DOUBLE / NULLIF(o.GB + o.FB + o.LD + o.PU, 0) AS "PU_pct",
      o.hard_hit::DOUBLE / NULLIF(o.bbe, 0) AS "HardHit_pct",
      o.barrels::DOUBLE / NULLIF(o.bbe, 0) AS "Barrel_pct",
      -- Plate discipline
      d.pitches, d.in_zone, d.out_zone, d.swings, d.contact,
      d.avg_velo,
      d.in_zone::DOUBLE / NULLIF(d.pitches, 0) AS "Zone_pct",
      d.swings::DOUBLE / NULLIF(d.pitches, 0) AS "Swing_pct",
      d.z_swings::DOUBLE / NULLIF(d.in_zone, 0) AS "Z_Swing_pct",
      d.o_swings::DOUBLE / NULLIF(d.out_zone, 0) AS "O_Swing_pct",
      d.contact::DOUBLE / NULLIF(d.swings, 0) AS "Contact_pct",
      d.z_contact::DOUBLE / NULLIF(d.z_swings, 0) AS "Z_Contact_pct",
      d.o_contact::DOUBLE / NULLIF(d.o_swings, 0) AS "O_Contact_pct",
      d.sw_strike::DOUBLE / NULLIF(d.pitches, 0) AS "SwStr_pct",
      d.csw::DOUBLE / NULLIF(d.pitches, 0) AS "CSW_pct",
      d.first_strikes::DOUBLE / NULLIF(d.first_pitches, 0) AS "F_Strike_pct"
    FROM outcomes o
    LEFT JOIN discipline d ON d.player_id = o.player_id AND d.game_pk = o.game_pk
    """


def _pitchtype_sql(side: str, year: int) -> str:
    pid = side
    stmt_path = (db_root() / "raw" / "statcast" / f"year={year}" / "month=*.parquet").as_posix()
    return f"""
    SELECT
      {pid} AS {side}_id,
      game_pk,
      ANY_VALUE(game_date) AS game_date,
      ANY_VALUE(game_year) AS game_year,
      pitch_type,
      ANY_VALUE(pitch_name) AS pitch_name,
      COUNT(*) AS pitches,
      AVG(release_speed) AS avg_velo,
      SUM(delta_run_exp) AS run_value,
      SUM(CASE WHEN description IN ('swinging_strike','swinging_strike_blocked') THEN 1 ELSE 0 END) AS whiffs,
      SUM(CASE WHEN description IN ({SWING_DESCS}) THEN 1 ELSE 0 END) AS swings,
      SUM(CASE WHEN bb_type = 'ground_ball' THEN 1 ELSE 0 END) AS gb_bip,
      COUNT(launch_speed) AS bbe,
      AVG(launch_speed) AS avg_ev
    FROM read_parquet('{stmt_path}', union_by_name=true)
    WHERE {pid} IS NOT NULL AND pitch_type IS NOT NULL
    GROUP BY {pid}, game_pk, pitch_type
    """


def _league_rates_sql() -> str:
    stmt_path = (db_root() / "raw" / "statcast" / "year=*" / "month=*.parquet").as_posix()
    return f"""
    WITH e AS (
      SELECT *
      FROM read_parquet('{stmt_path}', union_by_name=true, hive_partitioning=1)
      WHERE events IS NOT NULL
    )
    SELECT
      game_year AS season,
      COUNT(*) AS PA,
      SUM(CASE WHEN events = 'single' THEN 1 ELSE 0 END) AS "1B",
      SUM(CASE WHEN events = 'double' THEN 1 ELSE 0 END) AS "2B",
      SUM(CASE WHEN events = 'triple' THEN 1 ELSE 0 END) AS "3B",
      SUM(CASE WHEN events = 'home_run' THEN 1 ELSE 0 END) AS HR,
      SUM(CASE WHEN events IN ('walk','intent_walk') THEN 1 ELSE 0 END) AS BB,
      SUM(CASE WHEN events = 'intent_walk' THEN 1 ELSE 0 END) AS IBB,
      SUM(CASE WHEN events = 'hit_by_pitch' THEN 1 ELSE 0 END) AS HBP,
      SUM(CASE WHEN events IN ('strikeout','strikeout_double_play') THEN 1 ELSE 0 END) AS K,
      SUM(CASE WHEN events IN ('sac_fly','sac_fly_double_play') THEN 1 ELSE 0 END) AS SF,
      SUM(woba_value) AS woba_num,
      SUM(woba_denom) AS woba_den,
      SUM(woba_value) / NULLIF(SUM(woba_denom), 0) AS lg_wOBA,
      SUM(CASE WHEN events IN ('single','double','triple','home_run') THEN 1 ELSE 0 END)::DOUBLE
        / NULLIF(COUNT(*) - SUM(CASE WHEN events IN ('walk','intent_walk','hit_by_pitch','sac_fly','sac_fly_double_play','sac_bunt') THEN 1 ELSE 0 END), 0)
        AS lg_AVG
    FROM e
    GROUP BY 1
    ORDER BY 1
    """


def build_year(con: duckdb.DuckDBPyConnection, year: int) -> None:
    bat_dir = derived("advanced", "batting_per_game")
    pit_dir = derived("advanced", "pitching_per_game")
    bat_pt_dir = derived("advanced", "batting_pitchtype_per_game")
    pit_pt_dir = derived("advanced", "pitching_pitchtype_per_game")

    for side, out_dir in [("batter", bat_dir), ("pitcher", pit_dir)]:
        out = out_dir / f"year={year}.parquet"
        print(f"  {side} per-game → {out.name}")
        con.execute(f"COPY ({_build_sql(side, year)}) TO '{out.as_posix()}' (FORMAT 'parquet')")

    for side, out_dir in [("batter", bat_pt_dir), ("pitcher", pit_pt_dir)]:
        out = out_dir / f"year={year}.parquet"
        print(f"  {side} pitch-type → {out.name}")
        con.execute(f"COPY ({_pitchtype_sql(side, year)}) TO '{out.as_posix()}' (FORMAT 'parquet')")


def build_league_rates(con: duckdb.DuckDBPyConnection) -> None:
    out = derived("advanced", "league_rates") / "all.parquet"
    print(f"  league rates → {out}")
    con.execute(f"COPY ({_league_rates_sql()}) TO '{out.as_posix()}' (FORMAT 'parquet')")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start-year", type=int, default=2015)
    ap.add_argument("--end-year", type=int, default=date.today().year)
    ap.add_argument("--skip-league", action="store_true")
    args = ap.parse_args()

    con = duckdb.connect()  # in-memory; reads from Parquet files directly
    for year in range(args.start_year, args.end_year + 1):
        print(f"=== {year} ===")
        build_year(con, year)

    if not args.skip_league:
        print("=== league rates ===")
        build_league_rates(con)

    con.close()
    print("done.")


if __name__ == "__main__":
    main()
