# AI Collaboration Log

A "peek behind the curtain" of how this project was built with AI — the
tools used, the prompts that produced the core of the app, and a couple of
places where the AI got it wrong and had to be corrected. This covers the
work up to the first commit; the project is still being iterated on.

## 1. The AI Tech Stack

- **Claude Code** (terminal-based agentic coding tool), running on
  **Claude Opus 4.8** as the underlying model.
- Multiple Claude Code agents were run in parallel terminal sessions to
  work through different pieces of the build (backend, frontend, Docker
  setup) without one long serial session.
- **Claude for Chrome** (browser extension), authorized to inspect the
  running frontend directly — used to check rendered UI and iterate on
  layout/styling live instead of guessing from code alone.

## 2. The Prompts That Shipped It

My general approach across the whole build: understand before generating,
question before accepting a fix, and verify before moving on. That shows
up the same way in almost every session below.

**Brief first, code second.** Before any code was written, I gave Claude
the full assignment brief — the goal, the required stack (FastAPI +
APScheduler, Postgres, React, single `docker compose up`), and the MVP
constraints — and asked it to explain its understanding back to me before
touching any code:

> "We're building a small internal tool over multiple steps. Before you
> write ANY code or create ANY files, read this brief and then just
> confirm your understanding back to me — I'll tell you when to start
> building."

That pass surfaced decisions the brief didn't spell out — what counts as
"down," whether to follow redirects, whether a new URL gets checked
immediately or waits for the next tick. Once Claude laid out its plan, my
go-ahead was just:

> "yes, it matches"

**Building it in order.** From there we built the pieces in the order the
brief implied: database models → backend API → scheduler ("pinger") →
frontend dashboard → Docker Compose wiring it all together, each layer
reviewed and run before moving to the next.

**Scoping new features from research, not guesses.** Once the MVP worked,
instead of telling Claude what to add next, I asked it to research the
space first:

> "Apart from status code, what else can we capture from a URL? ... out of
> all these, what does a standard uptime production monitoring tool
> captures?"

I picked two of the options it came back with:

> "capture SSL certificate expiry and timings breakdown and improve the UI
> design accordingly"

That one prompt shipped the SSL expiry check, the DNS/Connect/TLS/TTFB
timing breakdown, and a UI redesign to display them.

**Pushing for transparency in what the UI shows.** When the new timing
breakdown looked inconsistent — DNS/Connect/TLS as bars, TTFB as a plain
number — I didn't just ask for a visual fix, I asked Claude to explain the
"why" to the end user too:

> "Why does the connections timings in the UI is divided betwen DNS,
> Connect and TLS but TTFB is shown differntly in numerical and not in the
> diagramicaly way and does all this add to the Total?"
>
> "The DNS, Connect, and TLS timings shown in the bar are collected using a
> separate raw socket, while TTFB and Total are derived from the actual
> HTTPX request. Could we expose this information somewhere in the UI and
> provide a brief explanation of what each metric represents and how it is
> calculated?"

**Building from my own friction using the app.** Late at night, staring at
a white dashboard was uncomfortable, so:

> "add the dark/light mode toggle (dark mode default)"

**Testing against a real DB GUI, then cleaning up after myself.** I wanted
to eyeball the schema in TablePlus, but asked about the cost before
touching the Docker setup:

> "tell me first what is an issue if I expose a port to see the tables in
> the tableplus, apart from the current docker compose flow"

I temporarily exposed the Postgres port to inspect tables during
development, then explicitly asked for it to be reverted once I was done:

> "remove the port exposed to check the schema and the column of
> healthcheck locally in the tableplus GUI"

**Authorizing the AI to see what I see.** For UI work, instead of
describing the frontend to Claude, I let it look directly:

> "how to connect the chrome extension"

I authorized the Claude for Chrome extension so it could inspect the
running dashboard itself rather than working blind from code.

**Turning the assignment's own requirements into a prompt, then
re-evaluating.** For the README, I fed the grading rubric back to Claude
directly instead of writing my own summary of it:

> "Your project README must clearly highlight: A 1-Line Setup ... an
> Infrastructure-as-Code (IaC) block mapping out how you would host this
> system on a cloud provider. this is required, lets discuss, this is like
> mandatory paart from that, make readme easy to understand, go through the
> codebase once"

Once a first version existed, I asked it to re-evaluate the README again
against that same rubric after later feature work (SSL expiry, timings,
dark mode) had landed, so the doc wouldn't drift out of sync with the
actual app — plus a small ask to make it visual instead of just text:

> "attach a @snapshot.png too to show how it will look in the readme file"

## 3. The Course Corrections

**Incomplete error handling I had to catch myself.** After adding the
`error_reason` column, I noticed it wasn't always filling in and pushed
back directly:

> "why is my error_reasom colum no being filled in the table"

Turned out Claude's original `checker.py` only set `error_reason` inside
the `except` block — i.e. for timeouts, DNS failures, and connection
errors. A monitor that got an actual HTTP response but with a bad status
code (a 404 or 500) took the "success" code path instead, so `is_up` was
correctly `False` but `error_reason` silently stayed `NULL`. It's the kind
of partial fix that looks correct until you hit the specific case it
missed. I had it patched so `error_reason` is set on *any* down result,
not just exception-based ones.

**A schema-migration blind spot.** This project has no migration tool —
`init_db()` just does SQLModel's `create_all()`, which only creates
missing tables and does nothing to existing ones. Both times I asked for a
new DB column (`error_reason`, then later `ssl_expires_at` /
`dns_ms`/`connect_ms`/`tls_ms`/`ttfb_ms`), the running Postgres volume
still had the old schema and the new fields silently wouldn't populate.
Claude flagged the limitation and, since this is local dev data with
nothing worth preserving, I told it to just wipe the volume rather than
hand-write `ALTER TABLE` statements each time. Wiping it the second time
also exposed a separate hidden bug — the `healthcheck` table had gone
missing from the volume entirely, so `/monitors` was failing under the
hood. Worth knowing before this project ever needs a real migration tool
(Alembic) for a non-throwaway database.

**Bad code Claude caught itself.** While building the API, Claude added a
`DELETE` endpoint for monitors that hadn't been asked for — and it was
broken: deleting a monitor with existing health checks would hit a
database foreign-key error. Claude flagged this itself and removed the
endpoint before I raised it. Good sign, but a reminder to review
AI-written endpoints for scope creep even when they look reasonable.

**The APScheduler bug — the biggest course correction.** The brief specified
APScheduler, which by default runs with `max_instances=1`: if a scheduled
run is still in progress when the next one is due, the next run is
skipped rather than overlapped. This surfaced as a real bug — after I
shortened the check interval from 60s to 10s, some monitors updated only
every ~50 seconds instead of every 10. Cause: one slow test URL took
almost the full timeout to fail, so its check run ate into the next
scheduled tick, which got skipped.

Claude's first suggestion was to just shorten the per-request timeout. I
pushed back and asked for the more principled option instead of the quick
patch:

> "so what do you expect to do, what is a better solution for this, do not
> rely on APSchedular?"

Claude laid out two real options: (1) shorten the timeout so no single
slow URL can eat the next tick, or (2) redesign the scheduler to fire off
each URL check independently instead of waiting for all of them to finish
before considering a tick "done." Before picking, I asked it to be
explicit about the downside of relying on APScheduler at all:

> "what is the tradeoff or limitation using this fire and forget method
> also how reliable is APSchedular?"

The honest answer: APScheduler runs in-process, so it only works
correctly with exactly one backend instance. Scale the backend to two
copies and each would run its own independent schedule, double-checking
every URL with no coordination between them. For an MVP watching a few
dozen URLs, I went with the simpler timeout fix and documented the
single-instance limitation rather than over-engineering a distributed
scheduler nobody asked for at this stage.

**An environment problem, not an AI problem, but worth a mention.** Docker
Desktop failed locally with `docker-credential-desktop: executable file
not found in $PATH` — a missing PATH entry on my machine, not a bug in the
generated code. Rather than blindly running the fix Claude suggested, I
asked it to explain the actual failure and what it would mean for anyone
else running this project:

> "but this project should be able to run on another machine locally as
> well without any issue with a single command, so what do you suggest,
> first tell me in simple way, what is the problem that I am facing on
> this machine and what will be the problem it will face if it is like
> this on machine machine, so that I can actually make a decision?"

That answer led to two things: fixing my own PATH, and adding a `run.sh`
wrapper script (build + wait for the backend to actually respond + print
the URLs) so anyone else cloning the repo gets a clear "your app is ready"
message and a documented fallback if they hit the same Docker error.

**Last but not least: writing this very log.** The final main prompt in
this whole process was asking Claude to take the running notes I'd kept
through development — a rough draft, not polished writing — and turn them
into this finished log, grounded in the actual project files and my real
prompt history rather than a generic summary:

> "Check out this project. I've completed almost everything except this
> remaining requirement: 2. Dedicated AI Collaboration Log (AI_LOG.md or a
> section in the README) ... I've already created a draft .md file. Please
> read it, complete it, and place the finished version at the project
> root."

## What's Next

This log reflects the project as of the first commit. Iteration continues
from here — the AI Tech Stack, prompting approach, and course-correction
habits above are the ones I intend to keep using.
