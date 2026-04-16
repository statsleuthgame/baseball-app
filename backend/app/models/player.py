from pydantic import BaseModel, Field


class PlayerDetail(BaseModel):
    id: int = Field(gt=0)
    fullName: str = Field(default="", min_length=0)
    firstName: str = ""
    lastName: str = ""
    primaryNumber: str = ""
    birthDate: str = ""
    age: int | None = Field(default=None, ge=0, le=100)
    height: str = ""
    weight: int | None = Field(default=None, gt=0, le=500)
    batSide: str = ""
    pitchHand: str = ""
    primaryPosition: str = ""
    mlbDebutDate: str = ""
    currentTeam: str = ""
    photoUrl: str = ""
