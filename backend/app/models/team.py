from pydantic import BaseModel, Field


class Venue(BaseModel):
    id: int | None = None
    name: str = ""


class Position(BaseModel):
    code: str = ""
    name: str = ""
    type: str = ""
    abbreviation: str = ""


class Player(BaseModel):
    id: int = Field(gt=0)
    fullName: str = Field(min_length=1)
    jerseyNumber: str = ""
    position: Position = Position()
    status: str = "Active"
    photoUrl: str = ""


class TeamInfo(BaseModel):
    id: int = Field(gt=0)
    name: str = Field(min_length=1)
    abbreviation: str = ""
    teamName: str = ""
    venue: Venue = Venue()
    league: str = ""
    division: str = ""
    logoUrl: str = ""


class TeamColors(BaseModel):
    primary: str = Field(min_length=1)
    secondary: str = Field(min_length=1)
    accent: str = Field(min_length=1)


class TeamMeta(BaseModel):
    info: TeamInfo
    colors: TeamColors
