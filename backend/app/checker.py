import asyncio
import time

import httpx
from sqlmodel import Session, select

from .db import engine
from .models import HealthCheck, Monitor

REQUEST_TIMEOUT_SECONDS = 5.0


async def check_one(client: httpx.AsyncClient, monitor: Monitor) -> HealthCheck:
    start = time.monotonic()
    try:
        response = await client.get(monitor.url, timeout=REQUEST_TIMEOUT_SECONDS)
        elapsed_ms = (time.monotonic() - start) * 1000
        is_up = 200 <= response.status_code < 400
        return HealthCheck(
            monitor_id=monitor.id,
            is_up=is_up,
            status_code=response.status_code,
            response_time_ms=elapsed_ms,
        )
    except httpx.HTTPError:
        return HealthCheck(
            monitor_id=monitor.id,
            is_up=False,
            status_code=None,
            response_time_ms=None,
        )


async def check_monitors(monitors: list[Monitor]) -> None:
    if not monitors:
        return

    async with httpx.AsyncClient(follow_redirects=False) as client:
        results = await asyncio.gather(*(check_one(client, m) for m in monitors))

    with Session(engine) as session:
        session.add_all(results)
        session.commit()


async def check_all_monitors() -> None:
    with Session(engine) as session:
        monitors = session.exec(select(Monitor)).all()
    await check_monitors(list(monitors))


async def check_single_monitor(monitor_id: int) -> None:
    with Session(engine) as session:
        monitor = session.get(Monitor, monitor_id)
    if monitor is not None:
        await check_monitors([monitor])
