from pydantic import BaseModel


class PlayerDetail(BaseModel):
    id: int
    fullName: str = ""
    firstName: str = ""
    lastName: str = ""
    primaryNumber: str = ""
    birthDate: str = ""
    age: int | None = None
    height: str = ""
    weight: int | None = None
    batSide: str = ""
    pitchHand: str = ""
    primaryPosition: str = ""
    mlbDebutDate: str = ""
    currentTeam: str = ""
    photoUrl: str = ""
