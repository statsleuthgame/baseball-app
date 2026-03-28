import json
import math
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import FRONTEND_ORIGIN
from app.services import mlb_api
# NOTE: The frontend bypasses most backend endpoints, using static pre-generated
# JSON + direct MLB API calls from the browser instead. These routers are kept
# for potential future use (e.g., if we need server-side caching or CORS proxying).
# Only the umpire router receives any live frontend traffic currently.
from app.routers import team, schedule, standings, player, hotplayers, spraychart, matchup, umpire, leaderboards


class SafeJSONEncoder(json.JSONEncoder):
    """JSON encoder that converts NaN/Inf to None instead of crashing."""

    def default(self, obj):
        try:
            return super().default(obj)
        except TypeError:
            return str(obj)

    def encode(self, o):
        return super().encode(self._sanitize(o))

    def _sanitize(self, obj):
        if isinstance(obj, float):
            if math.isnan(obj) or math.isinf(obj):
                return None
            return obj
        if isinstance(obj, dict):
            return {k: self._sanitize(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [self._sanitize(v) for v in obj]
        return obj


class SafeJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(
            content,
            cls=SafeJSONEncoder,
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await mlb_api.close_client()


app = FastAPI(
    title="Baseball Stats API",
    version="1.0.0",
    lifespan=lifespan,
    default_response_class=SafeJSONResponse,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_ORIGIN,
        "https://statsleuthgame.github.io",
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(team.router)
app.include_router(schedule.router)
app.include_router(standings.router)
app.include_router(player.router)
app.include_router(hotplayers.router)
app.include_router(spraychart.router)
app.include_router(matchup.router)
app.include_router(umpire.router)
app.include_router(leaderboards.router)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    print(f"Unhandled error on {request.url}: {exc}\n{tb}")
    return SafeJSONResponse(
        status_code=500,
        content={"error": str(exc), "path": str(request.url)},
    )


@app.get("/api/health")
async def health():
    return {"status": "ok"}
