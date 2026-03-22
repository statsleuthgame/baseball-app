from pydantic import BaseModel


class ProbablePitcher(BaseModel):
    id: int
    fullName: str = ""
    photoUrl: str = ""


class GameTeam(BaseModel):
    id: int | None = None
    name: str = ""
    abbreviation: str = ""
    score: int | None = None
    isWinner: bool = False
    probablePitcher: ProbablePitcher | None = None
    logoUrl: str = ""


class Venue(BaseModel):
    id: int | None = None
    name: str = ""


class Game(BaseModel):
    gamePk: int | None = None
    gameDate: str = ""
    status: str = ""
    venue: Venue = Venue()
    away: GameTeam = GameTeam()
    home: GameTeam = GameTeam()
