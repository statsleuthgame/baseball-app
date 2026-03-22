from pydantic import BaseModel


class Venue(BaseModel):
    id: int | None = None
    name: str = ""


class Position(BaseModel):
    code: str = ""
    name: str = ""
    type: str = ""
    abbreviation: str = ""


class Player(BaseModel):
    id: int
    fullName: str
    jerseyNumber: str = ""
    position: Position = Position()
    status: str = "Active"
    photoUrl: str = ""


class TeamInfo(BaseModel):
    id: int
    name: str
    abbreviation: str = ""
    teamName: str = ""
    venue: Venue = Venue()
    league: str = ""
    division: str = ""
    logoUrl: str = ""


class TeamColors(BaseModel):
    primary: str
    secondary: str
    accent: str


class TeamMeta(BaseModel):
    info: TeamInfo
    colors: TeamColors
