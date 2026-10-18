from pydantic import BaseModel, Field


class VoteRequest(BaseModel):
    poll_id: str
    option_id: str
    viewer_id: str = Field(min_length=3, max_length=100)


class PollOption(BaseModel):
    id: str
    label: str


class Poll(BaseModel):
    id: str
    event_id: str
    question: str
    options: list[PollOption]
    status: Literal["open", "closed"] = "open"

