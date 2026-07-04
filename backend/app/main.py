from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from .checker import check_single_monitor
from .db import get_session, init_db
from .models import HealthCheck, Monitor
from .scheduler import start_scheduler
from .schemas import MonitorCreate, MonitorRead


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    start_scheduler()
    yield


app = FastAPI(title="Uptime Monitor", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _to_monitor_read(session: Session, monitor: Monitor) -> MonitorRead:
    latest = session.exec(
        select(HealthCheck)
        .where(HealthCheck.monitor_id == monitor.id)
        .order_by(HealthCheck.checked_at.desc())
        .limit(1)
    ).first()

    return MonitorRead(
        id=monitor.id,
        url=monitor.url,
        name=monitor.name,
        created_at=monitor.created_at,
        is_up=latest.is_up if latest else None,
        status_code=latest.status_code if latest else None,
        response_time_ms=latest.response_time_ms if latest else None,
        last_checked_at=latest.checked_at if latest else None,
    )


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/monitors", response_model=list[MonitorRead])
def list_monitors(session: Session = Depends(get_session)):
    monitors = session.exec(select(Monitor).order_by(Monitor.created_at)).all()
    return [_to_monitor_read(session, m) for m in monitors]


@app.post("/monitors", response_model=MonitorRead)
def create_monitor(
    payload: MonitorCreate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    monitor = Monitor(url=payload.url, name=payload.name)
    session.add(monitor)
    session.commit()
    session.refresh(monitor)

    background_tasks.add_task(check_single_monitor, monitor.id)

    return _to_monitor_read(session, monitor)
