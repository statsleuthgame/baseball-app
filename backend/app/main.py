import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import FRONTEND_ORIGIN
from app.services import mlb_api
from app.routers import team, schedule, standings, player, hotplayers, spraychart, matchup


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await mlb_api.close_client()


app = FastAPI(title="Baseball Stats API", version="1.0.0", lifespan=lifespan)

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


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    print(f"Unhandled error on {request.url}: {exc}\n{tb}")
    return JSONResponse(
        status_code=500,
        content={"error": str(exc), "path": str(request.url)},
    )


@app.get("/api/health")
async def health():
    return {"status": "ok"}
