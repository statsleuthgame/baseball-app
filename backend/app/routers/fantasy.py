"""Fantasy score projections endpoint."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import sys
import time
from datetime import datetime, timezone
from datetime import date as date_cls
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from app.services import fantasy
from app.config import get_current_season

router = APIRouter()
logger = logging.getLogger(__name__)

# Cache path for the refresh-status heartbeat file. One file per app —
# the refresh is a single-tenant, manual operation so we don't need a
# proper job queue.
_STATUS_PATH = Path(__file__).resolve().parents[2] / "app" / "data" / "refresh_status.json"
_STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)

# Default Edge-repo path (matches EDGE_DAILY_PICKS_PATH default in
# edge_model_picks.py). Override via EDGE_REPO_PATH env if your clone
# lives elsewhere.
_DEFAULT_EDGE_REPO = (
    Path.home() / "Desktop" / "Visual Studio Projects" / "Edge"
)


@router.get("/api/fantasy/projections")
async def get_fantasy_projections(
    date: str | None = Query(
        default=None,
        description="Target date (YYYY-MM-DD). Defaults to today.",
        regex=r"^\d{4}-\d{2}-\d{2}$",
    ),
    season: int | None = Query(default=None, ge=1900, le=2100),
):
    """
    Projected PrizePicks-style fantasy score per hitter for the requested
    date's slate, ranked best to worst.

    Scoring:
      1B=3 · 2B=5 · 3B=8 · HR=10 · R=2 · RBI=2 · BB=2 · HBP=2 · SB=5
    """
    target_date = date
    if target_date is None:
        target_date = date_cls.today().isoformat()

    try:
        payload = await fantasy.project_slate(date_iso=target_date, season=season)
        return payload
    except Exception as e:
        logger.exception("fantasy projections failed for %s", target_date)
        raise HTTPException(status_code=502, detail=f"projection failed: {e}") from e


@router.get("/api/fantasy/weights")
async def get_fantasy_weights():
    """
    Expose the current fantasy-score model weights so the UI can surface
    'weights updated X ago · R²=Y' on the Edge tab footer.
    """
    return fantasy.load_weights()


# ---------------------------------------------------------------------------
# Manual refresh — rebuild today's PP lines + picks + parlays on demand.
# ---------------------------------------------------------------------------

def _write_status(state: str, **extra) -> None:
    """Persist the current refresh state so the status endpoint stays in
    sync across the subprocess lifetime."""
    doc = {"state": state, "updated_at": datetime.now(timezone.utc).isoformat(), **extra}
    try:
        _STATUS_PATH.write_text(json.dumps(doc, indent=2) + "\n")
    except Exception as e:
        logger.warning("refresh: failed to write status file (%s)", e)


def _read_status() -> dict:
    if not _STATUS_PATH.exists():
        return {"state": "idle"}
    try:
        return json.loads(_STATUS_PATH.read_text())
    except Exception:
        return {"state": "idle"}


async def _run_subprocess(cmd: list[str], cwd: Path | None, label: str,
                          env_extra: dict | None = None) -> tuple[int, str, str]:
    """Run `cmd` via asyncio.subprocess. Returns (rc, stdout_tail, stderr_tail).
    Large output is trimmed to the last 2K chars for logging — we don't
    want to blow up the status file with training logs."""
    logger.info("refresh[%s]: exec %s (cwd=%s)", label, " ".join(cmd), cwd)
    env = os.environ.copy()
    if env_extra:
        env.update(env_extra)
    proc = await asyncio.create_subprocess_exec(
        *cmd, cwd=str(cwd) if cwd else None, env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    out_tail = (stdout or b"").decode("utf-8", errors="replace")[-2000:]
    err_tail = (stderr or b"").decode("utf-8", errors="replace")[-2000:]
    logger.info("refresh[%s]: rc=%d", label, proc.returncode)
    return proc.returncode, out_tail, err_tail


async def _refresh_pipeline(target_date: str | None, include_model: bool) -> dict:
    """Execute the full refresh pipeline end-to-end. Writes heartbeats
    to the status file at every step so the UI can show progress."""
    started_at = time.monotonic()
    steps: list[dict] = []
    _write_status("running", step="starting", target_date=target_date,
                  include_model=include_model, steps=steps)

    # Step 1 (optional): Edge-repo daily_picks.json
    if include_model:
        edge_repo = Path(os.environ.get("EDGE_REPO_PATH") or _DEFAULT_EDGE_REPO).expanduser()
        if not edge_repo.exists():
            msg = f"EDGE_REPO_PATH {edge_repo} does not exist — skipping model step"
            logger.warning("refresh: %s", msg)
            steps.append({"name": "edge_model", "status": "skipped", "detail": msg})
        else:
            _write_status("running", step="edge_model", target_date=target_date,
                          include_model=include_model, steps=steps)
            cmd = [sys.executable, "-m", "scripts.tools.generate_daily_picks"]
            if target_date:
                cmd += ["--date", target_date]
            rc, out, err = await _run_subprocess(cmd, cwd=edge_repo, label="edge_model")
            steps.append({
                "name": "edge_model",
                "status": "ok" if rc == 0 else "failed",
                "rc": rc,
                "stdout_tail": out[-500:],
                "stderr_tail": err[-500:],
            })
            if rc != 0:
                _write_status("failed", step="edge_model", steps=steps,
                              duration_s=round(time.monotonic() - started_at, 1))
                return {"ok": False, "failed_step": "edge_model", "steps": steps}

    # Step 2: Baseball App projections + locks + parlays
    _write_status("running", step="fantasy_projections", target_date=target_date,
                  include_model=include_model, steps=steps)
    script = Path(__file__).resolve().parents[3] / "scripts" / "generate_fantasy_projections.py"
    if not script.exists():
        _write_status("failed", step="fantasy_projections",
                      detail=f"missing {script}", steps=steps)
        raise HTTPException(status_code=500, detail=f"missing {script}")
    cmd = [sys.executable, str(script)]
    if target_date:
        cmd += ["--date", target_date]
    rc, out, err = await _run_subprocess(cmd, cwd=script.parent.parent,
                                          label="fantasy_projections")
    steps.append({
        "name": "fantasy_projections",
        "status": "ok" if rc == 0 else "failed",
        "rc": rc,
        "stdout_tail": out[-500:],
        "stderr_tail": err[-500:],
    })
    if rc != 0:
        _write_status("failed", step="fantasy_projections", steps=steps,
                      duration_s=round(time.monotonic() - started_at, 1))
        return {"ok": False, "failed_step": "fantasy_projections", "steps": steps}

    duration = round(time.monotonic() - started_at, 1)
    _write_status("completed", steps=steps, duration_s=duration,
                  target_date=target_date, include_model=include_model)
    return {"ok": True, "steps": steps, "duration_s": duration}


@router.post("/api/fantasy/refresh")
async def trigger_refresh(
    date: str | None = Query(
        default=None,
        description="Target date (YYYY-MM-DD). Defaults to today.",
        regex=r"^\d{4}-\d{2}-\d{2}$",
    ),
    include_model: bool = Query(
        default=True,
        description="Also refresh Edge-repo Model 1 picks (~30-45s extra).",
    ),
):
    """Manual trigger that rebuilds everything the Edge page reads —
    PrizePicks lines, fantasy projections, best-bets, daily picks lock,
    legacy parlay ideas, AND the new best-parlays slate.

    Runs synchronously. Expect ~60-120s total:
      - Edge-repo daily_picks.json (~30-45s, optional)
      - generate_fantasy_projections.py (~20-40s)

    Status heartbeats are written to `app/data/refresh_status.json` so
    the matching GET endpoint can show progress while this POST is in
    flight."""
    # Refuse to run two refreshes at once.
    cur = _read_status()
    if cur.get("state") == "running":
        raise HTTPException(status_code=409, detail={
            "message": "refresh already running",
            "since": cur.get("updated_at"),
            "step":  cur.get("step"),
        })
    try:
        result = await _refresh_pipeline(date, include_model)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("refresh: pipeline crashed")
        _write_status("failed", detail=str(e))
        raise HTTPException(status_code=500, detail=f"refresh crashed: {e}") from e
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail={
            "message": "refresh failed",
            "failed_step": result.get("failed_step"),
            "steps": result.get("steps"),
        })
    return result


@router.get("/api/fantasy/refresh/status")
async def get_refresh_status():
    """Read the heartbeat file so the UI can poll progress while a
    refresh is in flight (or show the timestamp of the last run)."""
    return _read_status()
