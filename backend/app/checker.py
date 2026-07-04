import asyncio
import socket
import ssl
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx
from sqlmodel import Session, select

from .db import engine
from .models import HealthCheck, Monitor

REQUEST_TIMEOUT_SECONDS = 5.0
PROBE_TIMEOUT_SECONDS = 5.0


async def _probe_connection(url: str) -> dict:
    """Independently measure DNS/connect/TLS setup time and SSL cert expiry.

    Uses a separate raw connection from the actual content check, since httpx
    doesn't expose per-phase connection timing.
    """
    parsed = urlsplit(url)
    hostname = parsed.hostname
    if hostname is None:
        return {}

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    probe: dict = {}
    writer = None
    try:
        loop = asyncio.get_event_loop()

        t0 = time.monotonic()
        await asyncio.wait_for(
            loop.getaddrinfo(hostname, port, type=socket.SOCK_STREAM),
            PROBE_TIMEOUT_SECONDS,
        )
        probe["dns_ms"] = (time.monotonic() - t0) * 1000

        t1 = time.monotonic()
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(hostname, port), PROBE_TIMEOUT_SECONDS
        )
        probe["connect_ms"] = (time.monotonic() - t1) * 1000

        if parsed.scheme == "https":
            t2 = time.monotonic()
            ssl_context = ssl.create_default_context()
            tls_transport = await asyncio.wait_for(
                loop.start_tls(
                    writer.transport,
                    writer.transport.get_protocol(),
                    ssl_context,
                    server_hostname=hostname,
                ),
                PROBE_TIMEOUT_SECONDS,
            )
            probe["tls_ms"] = (time.monotonic() - t2) * 1000
            writer = None  # start_tls consumed the old transport

            ssl_object = tls_transport.get_extra_info("ssl_object")
            cert = ssl_object.getpeercert() if ssl_object else None
            if cert and cert.get("notAfter"):
                probe["ssl_expires_at"] = datetime.strptime(
                    cert["notAfter"], "%b %d %H:%M:%S %Y %Z"
                ).replace(tzinfo=timezone.utc)
            tls_transport.close()
    except Exception:
        pass
    finally:
        if writer is not None:
            writer.close()

    return probe


async def check_one(client: httpx.AsyncClient, monitor: Monitor) -> HealthCheck:
    start = time.monotonic()
    probe_task = asyncio.create_task(_probe_connection(monitor.url))
    try:
        async with client.stream(
            "GET", monitor.url, timeout=REQUEST_TIMEOUT_SECONDS
        ) as response:
            ttfb_ms = (time.monotonic() - start) * 1000
            await response.aread()
        elapsed_ms = (time.monotonic() - start) * 1000
        is_up = 200 <= response.status_code < 400
        probe = await probe_task
        return HealthCheck(
            monitor_id=monitor.id,
            is_up=is_up,
            status_code=response.status_code,
            response_time_ms=elapsed_ms,
            ttfb_ms=ttfb_ms,
            error_reason=None if is_up else f"HTTP {response.status_code}",
            **probe,
        )
    except httpx.HTTPError as exc:
        probe = await probe_task
        return HealthCheck(
            monitor_id=monitor.id,
            is_up=False,
            status_code=None,
            response_time_ms=None,
            error_reason=f"{type(exc).__name__}: {exc}",
            **probe,
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
