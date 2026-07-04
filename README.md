# Uptime Monitor

A minimal uptime monitor: register URLs, and an in-process scheduler pings
each one every 10 seconds and records the result. The dashboard polls the API
and shows current status (up/down) and latest response time for every
monitored URL.

## Stack

- **Backend**: FastAPI + httpx (async) + APScheduler (in-process, no
  Celery/Redis) + SQLModel
- **Database**: Postgres — every individual health check is stored, not just
  the latest
- **Frontend**: React + Vite, built and served by nginx
- Everything runs locally via a single `docker compose up`

## Running it

```
./run.sh
```

This builds and starts everything (`docker compose up --build -d` under the
hood), waits for the backend to become reachable, then prints the URLs:

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000 (docs at http://localhost:8000/docs)

You can also just run `docker compose up --build` directly if you'd rather
see container logs stream in the foreground — `run.sh` is a thin convenience
wrapper, not a requirement.

Add a URL from the dashboard form, or directly via the API:

```
curl -X POST http://localhost:8000/monitors \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "name": "Example"}'
```

A newly registered URL is checked immediately (in the background) rather than
waiting for the next scheduled tick, so it shows a real status within a few
seconds.

### Troubleshooting: `docker-credential-desktop: executable file not found`

If `./run.sh` (or `docker compose up --build`) fails with an error like:

```
error getting credentials - err: exec: "docker-credential-desktop": executable file not found in $PATH
```

this is a local Docker Desktop (macOS) setup issue, not a problem with this
project — Docker is configured to look up a credential helper binary before
pulling any image (even public ones), and that binary's folder isn't on your
shell's `PATH`. Fix it by adding Docker's bundled `bin` folder to your `PATH`:

```
echo 'export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

(use `~/.bashrc` or `~/.bash_profile` instead if you're on bash). Then retry
`./run.sh`. If that doesn't resolve it, fully quit Docker Desktop from the
menu bar (not just closing the window) and reopen it, then try again.

## How "up" vs "down" is determined

- **Up**: the HTTP request completes with a 2xx or 3xx status code.
- **Down**: the request completes with a 4xx/5xx status code, or fails
  outright (timeout, DNS failure, connection refused). In the failure case,
  `status_code` and `response_time_ms` are stored as `null` since there was
  no valid response.

Redirects are not followed when checking a URL — this is what allows 3xx to
be observed and recorded as "up" per the definition above; following
redirects would silently resolve to the final status code instead.

## Architecture notes

- The scheduler is a single `AsyncIOScheduler` job running inside the FastAPI
  process, firing every 10 seconds and checking all registered URLs
  concurrently with a shared `httpx.AsyncClient`. This is intentionally not
  distributed — fine for a few dozen URLs, and it also means the job runs
  once immediately on backend startup so existing monitors get fresh data
  without waiting for the first tick.
- `GET /monitors` derives each monitor's current status by looking up its
  most recent `HealthCheck` row rather than maintaining a separate mutable
  "current status" column — simplest correct option at this scale.
- The frontend polls `GET /monitors` every 5 seconds, independently of the
  10-second backend check interval — it's just how quickly the UI reflects
  data that's already there.
- `created_at`/`checked_at` are stored as timezone-aware UTC timestamps
  (`TIMESTAMPTZ`) so the API always returns an explicit UTC offset, and the
  frontend renders it in the browser's local timezone with the zone name
  shown.

## Project layout

```
backend/    FastAPI app, models, scheduler, Dockerfile
frontend/   React + Vite dashboard, nginx Dockerfile
docker-compose.yml
run.sh      convenience wrapper: build, start, wait for health, print URLs
```
