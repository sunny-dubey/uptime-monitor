from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Monitor(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    url: str
    name: Optional[str] = None
    created_at: datetime = Field(
        default_factory=utcnow, sa_column=Column(DateTime(timezone=True))
    )


class HealthCheck(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    monitor_id: int = Field(foreign_key="monitor.id", index=True)
    is_up: bool
    status_code: Optional[int] = None
    response_time_ms: Optional[float] = None
    checked_at: datetime = Field(
        default_factory=utcnow,
        sa_column=Column(DateTime(timezone=True), index=True),
    )
