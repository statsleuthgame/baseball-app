from pydantic import BaseModel, Field


class StandingsTeam(BaseModel):
    id: int | None = None
    name: str = ""
    abbreviation: str = ""
    wins: int = Field(default=0, ge=0)
    losses: int = Field(default=0, ge=0)
    winPct: str = ".000"
    gamesBack: str = "-"
    streakCode: str = ""
    last10: str = ""
    logoUrl: str = ""


class Division(BaseModel):
    divisionId: int | None = None
    divisionName: str = ""
    teams: list[StandingsTeam] = []


class PlayoffOdds(BaseModel):
    teamId: int
    teamName: str = ""
    winDivision: str = ""
    makePlayoffs: str = ""
    winWorldSeries: str = ""
