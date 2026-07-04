from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .checker import check_all_monitors

CHECK_INTERVAL_SECONDS = 10

scheduler = AsyncIOScheduler()


def start_scheduler() -> None:
    scheduler.add_job(
        check_all_monitors,
        "interval",
        seconds=CHECK_INTERVAL_SECONDS,
        id="check_all_monitors",
    )
    scheduler.start()
