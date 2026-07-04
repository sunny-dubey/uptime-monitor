from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

from pydantic import field_validator
from sqlmodel import SQLModel


class MonitorCreate(SQLModel):
    url: str
    name: Optional[str] = None

    @field_validator("url")
    @classmethod
    def require_scheme_and_host(cls, v: str) -> str:
        parsed = urlparse(v)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError(
                "url must be a full URL including http:// or https://"
            )
        return v


class MonitorRead(SQLModel):
    id: int
    url: str
    name: Optional[str]
    created_at: datetime
    is_up: Optional[bool] = None
    status_code: Optional[int] = None
    response_time_ms: Optional[float] = None
    last_checked_at: Optional[datetime] = None
