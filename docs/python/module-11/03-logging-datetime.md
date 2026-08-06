---
title: Logging & Datetime
outline: deep
---

# Logging & Datetime

Interview weight: 🔥🔥 | Python 3.9+ for `zoneinfo` | Prerequisites: [Module 4 — OOP](/python/module-04/), [Module 6 — Error Handling](/python/module-06/)

## 🗣️ In Plain English

::: tip In Plain English
Python's logging module is like a building's PA system. There are speakers on every floor (loggers), connected through a hierarchy (the logger tree). When someone makes an announcement on floor 3, it travels UP to every speaker above unless someone explicitly stops it (`propagate=False`). Each speaker has a volume knob (level) — set it to "emergencies only" and routine messages are filtered out before they even reach the speaker.

But speakers alone do not produce sound. Each speaker is connected to zero or more OUTPUT devices called handlers. Some announcements go to the wall monitor (StreamHandler to the console), some to a filing cabinet (FileHandler to disk), some to a central control room (SocketHandler to a remote service). You can attach multiple devices to a single speaker — the same announcement goes to all of them.

Finally, each output device has a template that decides HOW the announcement sounds. Should it include the floor number? A timestamp? The name of the person who made the call? Those templates are formatters, and each handler gets its own. The monitor on the wall might show just the message, while the filing cabinet records the full timestamp, the floor, and the severity level.

The most common mistake is talking directly into the ROOT speaker (calling `logging.info()` at the module level or using `basicConfig`). That works for scripts, but in a large application, every library and every module shouting into the same speaker produces chaos. The right approach is for each module to get its own speaker (`getLogger(__name__)`) and let the application owner decide at startup which speakers should be loud, which should be quiet, and where the output should go.

Now, datetime. Imagine every city in the world has its own clock on its own wall, and some of those clocks have a label saying which city they belong to (aware datetimes) while others are just blank clocks with no label (naive datetimes). If you ship a blank clock from Tokyo to London, someone in London will read the time on it and assume it is London time. That is exactly what happens with naive datetimes — they carry no timezone information, so every piece of code that touches them guesses based on its own context. The solution is simple: always put a label on your clocks. In Python, that label is a `tzinfo` object, and the modern way to create one is `ZoneInfo("UTC")` or `ZoneInfo("America/New_York")`.
:::

## ⚙️ Under the Hood

### The Logging Architecture

Python's logging module has four core components arranged in a pipeline:

```
Logger  ->  Handler  ->  Formatter  ->  Output
  |             |
 Level        Level
 Filter       Filter
```

A log record flows from a Logger (which decides whether the message is important enough), through one or more Handlers (which decide where it goes), each of which applies a Formatter (which decides how it looks).

#### Logger Hierarchy and Propagation

```python
# run: python3 logging_hierarchy.py
"""Logger hierarchy — how loggers form a tree and propagate records."""

import logging

# getLogger() returns a logger in a dot-separated hierarchy
# "myapp" is the parent of "myapp.db" which is the parent of "myapp.db.queries"
root = logging.getLogger()          # root logger (no name)
app = logging.getLogger("myapp")
db = logging.getLogger("myapp.db")
queries = logging.getLogger("myapp.db.queries")

# Calling getLogger with the same name returns the SAME object (singleton)
assert logging.getLogger("myapp") is app

# Set up a handler on the root logger
handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter("%(name)-25s %(levelname)-8s %(message)s"))
root.addHandler(handler)
root.setLevel(logging.DEBUG)

# Propagation: a record logged to "myapp.db.queries" propagates UP
# through "myapp.db" -> "myapp" -> root
# Each logger along the way checks its own level and handlers
queries.info("SELECT * FROM users")
# Output: myapp.db.queries         INFO     SELECT * FROM users
# The record was created at "myapp.db.queries" but handled by root's handler

# Set a level filter on the db logger
db.setLevel(logging.WARNING)

# Now INFO from queries is blocked at the db level
queries.info("This will NOT appear — db level is WARNING")
queries.warning("This WILL appear — meets db's WARNING threshold")

# Propagation can be stopped
db.propagate = False
db.addHandler(handler)  # db needs its own handler now
queries.error("This goes to db's handler only, not root")

# Best practice: getLogger(__name__) in every module
# In myapp/db/queries.py:  logger = logging.getLogger(__name__)
# __name__ is "myapp.db.queries" — automatically fits the hierarchy

# Clean up
root.removeHandler(handler)
db.removeHandler(handler)
db.propagate = True
```

#### Log Levels

```python
# run: python3 logging_levels.py
"""Log levels — numeric values and filtering semantics."""

import logging

# Levels are integers — a logger/handler only passes records at or ABOVE its level
print("Level values:")
for name in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
    print(f"  {name:>10} = {getattr(logging, name)}")

# DEBUG    = 10  — verbose diagnostic info (variable values, flow tracing)
# INFO     = 20  — confirmation that things are working as expected
# WARNING  = 30  — something unexpected but not an error (yet)
# ERROR    = 40  — a specific operation failed
# CRITICAL = 50  — the program itself may not be able to continue

# The logger level acts as the FIRST filter
logger = logging.getLogger("demo.levels")
logger.setLevel(logging.WARNING)

# These are suppressed BEFORE reaching any handler
logger.debug("Suppressed at logger level")
logger.info("Suppressed at logger level")

# These pass the logger filter
logger.warning("Passes logger filter")
logger.error("Passes logger filter")

# The handler has its OWN level (second filter)
handler = logging.StreamHandler()
handler.setLevel(logging.ERROR)  # handler only passes ERROR+
handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
logger.addHandler(handler)
logger.propagate = False

logger.warning("Passes logger (WARNING>=WARNING) but blocked by handler (WARNING<ERROR)")
logger.error("Passes BOTH filters — this appears")

logger.removeHandler(handler)
```

#### Handlers: Where Log Records Go

```python
# run: python3 logging_handlers.py
"""Common handlers — StreamHandler, FileHandler, RotatingFileHandler."""

import logging
from logging.handlers import RotatingFileHandler, TimedRotatingFileHandler
from pathlib import Path

logger = logging.getLogger("demo.handlers")
logger.setLevel(logging.DEBUG)
logger.propagate = False

# 1. StreamHandler — writes to stderr (default) or stdout
console = logging.StreamHandler()
console.setLevel(logging.INFO)
console.setFormatter(logging.Formatter("%(levelname)-8s %(message)s"))
logger.addHandler(console)

# 2. FileHandler — writes to a single file (grows forever)
log_file = Path("app.log")
file_handler = logging.FileHandler(log_file, encoding="utf-8")
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(logging.Formatter(
    "%(asctime)s %(name)s %(levelname)s %(message)s"
))
logger.addHandler(file_handler)

# 3. RotatingFileHandler — rotates when file reaches maxBytes
rotating = RotatingFileHandler(
    "app_rotating.log",
    maxBytes=1_000_000,   # 1 MB per file
    backupCount=5,        # keep 5 rotated files (app.log.1, .2, .3, .4, .5)
    encoding="utf-8",
)
rotating.setLevel(logging.WARNING)
rotating.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logger.addHandler(rotating)

# 4. TimedRotatingFileHandler — rotates by time
timed = TimedRotatingFileHandler(
    "app_timed.log",
    when="midnight",      # rotate at midnight (also: S, M, H, D, W0-W6)
    backupCount=30,       # keep 30 days
    encoding="utf-8",
)

# Log some messages
logger.debug("Debug — only goes to file (console level is INFO)")
logger.info("Info — goes to console and file")
logger.warning("Warning — goes to console, file, AND rotating file")
logger.error("Error — goes everywhere")

# Clean up
for h in logger.handlers[:]:
    h.close()
    logger.removeHandler(h)

for f in Path(".").glob("app*.log*"):
    f.unlink()
```

#### Formatters and Lazy Formatting

```python
# run: python3 logging_formatters.py
"""Formatters and the lazy formatting rule."""

import logging

logger = logging.getLogger("demo.format")
logger.setLevel(logging.DEBUG)
logger.propagate = False

# Format strings use %-style placeholders for LogRecord attributes
# Common attributes:
#   %(asctime)s    — human-readable timestamp
#   %(name)s       — logger name
#   %(levelname)s  — level name (DEBUG, INFO, etc.)
#   %(message)s    — the log message
#   %(filename)s   — source filename
#   %(lineno)d     — source line number
#   %(funcName)s   — function name
#   %(process)d    — process ID
#   %(thread)d     — thread ID

handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter(
    fmt="%(asctime)s [%(levelname)s] %(name)s:%(lineno)d — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",  # custom date format
))
logger.addHandler(handler)

logger.info("Application started")
logger.error("Connection failed to database")


# LAZY FORMATTING: use %-style args, NOT f-strings
# This is a performance optimization — the string is only formatted
# if the message passes the level filter
class ExpensiveObject:
    def __repr__(self) -> str:
        print("  (ExpensiveObject.__repr__ was called)")
        return "expensive-result"

obj = ExpensiveObject()

# BAD: f-string always evaluates, even if level filters the message
# logger.debug(f"Processing {obj}")  # __repr__ called even if debug is filtered

# GOOD: %-style args — only formatted if the message will actually be emitted
logger.setLevel(logging.WARNING)
logger.debug("Processing %s", obj)  # __repr__ is NOT called (debug < warning)
print("Notice: __repr__ was not called above because debug was filtered")

logger.setLevel(logging.DEBUG)
logger.debug("Processing %s", obj)  # __repr__ IS called (debug passes)

logger.removeHandler(handler)
```

#### dictConfig: Modern Logging Configuration

```python
# run: python3 logging_dictconfig.py
"""dictConfig — the recommended way to configure logging in applications."""

import logging
import logging.config

# dictConfig is the modern way to configure logging.
# It replaces fileConfig and manual setup with a declarative dict.

LOGGING_CONFIG = {
    "version": 1,  # required, must be 1
    "disable_existing_loggers": False,  # don't silence third-party loggers

    "formatters": {
        "standard": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        },
        "detailed": {
            "format": "%(asctime)s [%(levelname)s] %(name)s:%(filename)s:%(lineno)d — %(message)s",
        },
    },

    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "level": "INFO",
            "formatter": "standard",
            "stream": "ext://sys.stdout",  # ext:// references external objects
        },
        "file": {
            "class": "logging.handlers.RotatingFileHandler",
            "level": "DEBUG",
            "formatter": "detailed",
            "filename": "app_dictconfig.log",
            "maxBytes": 10_000_000,
            "backupCount": 3,
            "encoding": "utf-8",
        },
    },

    "loggers": {
        "myapp": {
            "level": "DEBUG",
            "handlers": ["console", "file"],
            "propagate": False,
        },
        "myapp.db": {
            "level": "WARNING",  # suppress noisy DB logs
            # handlers inherited via propagation to "myapp"
            "propagate": True,
        },
    },

    "root": {
        "level": "WARNING",
        "handlers": ["console"],
    },
}

logging.config.dictConfig(LOGGING_CONFIG)

# Now use loggers
app_logger = logging.getLogger("myapp")
db_logger = logging.getLogger("myapp.db")

app_logger.info("Application started")
app_logger.debug("Debug — goes to file only (console level is INFO)")
db_logger.info("DB query — suppressed (db level is WARNING)")
db_logger.warning("Slow query detected — passes db level")

# Clean up
from pathlib import Path
for f in Path(".").glob("app_dictconfig*"):
    f.unlink()
```

#### Structured Logging with Extra Fields

```python
# run: python3 logging_structured.py
"""Structured logging — adding context and producing JSON output."""

import logging
import json
from datetime import datetime, timezone


# Custom formatter that outputs JSON lines
class JSONFormatter(logging.Formatter):
    """Format log records as JSON — ready for ELK, Datadog, CloudWatch."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno,
        }

        # Include extra fields if present
        if hasattr(record, "request_id"):
            log_entry["request_id"] = record.request_id
        if hasattr(record, "user_id"):
            log_entry["user_id"] = record.user_id
        if record.exc_info and record.exc_info[0] is not None:
            log_entry["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_entry, default=str)


# Set up structured logging
logger = logging.getLogger("myapp.api")
logger.setLevel(logging.DEBUG)
logger.propagate = False

handler = logging.StreamHandler()
handler.setFormatter(JSONFormatter())
logger.addHandler(handler)

# Basic structured log
logger.info("Request received")

# Adding context via extra parameter
logger.info(
    "Processing request",
    extra={"request_id": "abc-123", "user_id": 42},
)

# Logging exceptions with traceback
try:
    result = 1 / 0
except ZeroDivisionError:
    logger.error("Calculation failed", exc_info=True, extra={"request_id": "abc-123"})

# Using a Filter to automatically add context
class RequestContextFilter(logging.Filter):
    """Add request context to every log record."""

    def __init__(self, request_id: str) -> None:
        super().__init__()
        self.request_id = request_id

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = self.request_id  # type: ignore[attr-defined]
        return True  # True = allow the record through


# Attach filter (in practice, add/remove per-request)
ctx_filter = RequestContextFilter("req-456")
logger.addFilter(ctx_filter)
logger.info("Automatic context in every log")
logger.removeFilter(ctx_filter)

logger.removeHandler(handler)
```

---

### datetime: Dates, Times, and Arithmetic

#### Core Types and Construction

```python
# run: python3 datetime_basics.py
"""datetime core types — date, time, datetime, timedelta."""

from datetime import date, time, datetime, timedelta, timezone

# date — calendar date only (no time, no timezone)
d = date(2024, 6, 15)
print(f"date: {d}")
print(f"  year={d.year}, month={d.month}, day={d.day}")
print(f"  weekday={d.weekday()} (0=Mon), isoweekday={d.isoweekday()} (1=Mon)")
print(f"  today: {date.today()}")

# time — wall clock time only (no date)
t = time(14, 30, 45, 123456)  # hour, minute, second, microsecond
print(f"\ntime: {t}")
print(f"  hour={t.hour}, minute={t.minute}, second={t.second}, us={t.microsecond}")

# datetime — date + time combined
dt = datetime(2024, 6, 15, 14, 30, 45)
print(f"\ndatetime: {dt}")
print(f"  date part: {dt.date()}")
print(f"  time part: {dt.time()}")

# NOW — with timezone (always prefer this)
now_utc = datetime.now(timezone.utc)
print(f"\nnow (UTC): {now_utc}")
print(f"  isoformat: {now_utc.isoformat()}")

# timedelta — a duration
delta = timedelta(days=7, hours=3, minutes=30)
print(f"\ntimedelta: {delta}")
print(f"  total_seconds: {delta.total_seconds()}")

# Arithmetic
tomorrow = date.today() + timedelta(days=1)
print(f"\ntomorrow: {tomorrow}")

# Subtracting two datetimes gives a timedelta
dt1 = datetime(2024, 6, 15, 10, 0)
dt2 = datetime(2024, 6, 17, 14, 30)
diff = dt2 - dt1
print(f"difference: {diff}")            # 2 days, 4:30:00
print(f"total hours: {diff.total_seconds() / 3600:.1f}")  # 52.5
```

#### Timezone Handling with zoneinfo

```python
# run: python3 datetime_timezones.py
"""Timezone handling — zoneinfo (3.9+), naive vs aware, conversions."""

from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

# NAIVE datetime — no timezone info. This is a bug waiting to happen.
naive = datetime(2024, 6, 15, 10, 30)
print(f"Naive: {naive}")
print(f"  tzinfo: {naive.tzinfo}")  # None — what timezone is this? Nobody knows.

# AWARE datetime — has timezone info. Always prefer this.
utc_time = datetime(2024, 6, 15, 10, 30, tzinfo=timezone.utc)
print(f"\nAware (UTC): {utc_time}")
print(f"  tzinfo: {utc_time.tzinfo}")

# Using zoneinfo (Python 3.9+) for named timezones
eastern = ZoneInfo("America/New_York")
tokyo = ZoneInfo("Asia/Tokyo")
london = ZoneInfo("Europe/London")

# Create aware datetimes in specific timezones
ny_time = datetime(2024, 6, 15, 10, 30, tzinfo=eastern)
print(f"\nNew York: {ny_time}")
print(f"  UTC offset: {ny_time.utcoffset()}")  # -4:00 (EDT in June)

# Convert between timezones using .astimezone()
tokyo_time = ny_time.astimezone(tokyo)
london_time = ny_time.astimezone(london)
utc_equiv = ny_time.astimezone(timezone.utc)

print(f"\nSame moment in time:")
print(f"  New York:  {ny_time}")
print(f"  Tokyo:     {tokyo_time}")
print(f"  London:    {london_time}")
print(f"  UTC:       {utc_equiv}")

# CRITICAL: datetime.now() without timezone returns NAIVE — avoid this
bad = datetime.now()        # naive — what timezone? depends on server location
good = datetime.now(timezone.utc)  # aware — explicitly UTC

# The right pattern for "current time":
now = datetime.now(timezone.utc)
print(f"\nCurrent time (UTC): {now.isoformat()}")

# WHY NAIVE DATETIMES ARE BUGS:
# If server A is in UTC and server B is in US/Eastern:
# Server A: datetime.now() = 2024-06-15 14:00:00
# Server B: datetime.now() = 2024-06-15 10:00:00
# If you compare these naive datetimes, 14:00 > 10:00, but they're the
# SAME moment. Naive datetimes silently produce wrong comparisons,
# wrong durations, and wrong billing calculations.

# DST transitions — zoneinfo handles them correctly
before_dst = datetime(2024, 3, 10, 1, 30, tzinfo=eastern)  # 1:30 AM EST
after_dst = datetime(2024, 3, 10, 3, 30, tzinfo=eastern)   # 3:30 AM EDT
gap = after_dst - before_dst
print(f"\nDST gap: {before_dst} -> {after_dst} = {gap}")
# Only 1 hour passed (2:00 AM -> 3:00 AM, skipping the missing hour)
```

#### Formatting and Parsing

```python
# run: python3 datetime_formatting.py
"""Formatting (strftime) and parsing (strptime, fromisoformat)."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

dt = datetime(2024, 6, 15, 14, 30, 45, tzinfo=timezone.utc)

# strftime — datetime to formatted string
print("--- strftime (formatting) ---")
print(f"ISO 8601:     {dt.strftime('%Y-%m-%dT%H:%M:%S%z')}")
print(f"Human:        {dt.strftime('%B %d, %Y at %I:%M %p')}")
print(f"Log format:   {dt.strftime('%Y-%m-%d %H:%M:%S')}")
print(f"Compact:      {dt.strftime('%Y%m%d_%H%M%S')}")
print(f"Day of week:  {dt.strftime('%A')}")

# Common format codes:
# %Y = 4-digit year    %m = zero-padded month   %d = zero-padded day
# %H = 24-hour hour    %M = minute              %S = second
# %I = 12-hour hour    %p = AM/PM
# %A = full weekday    %B = full month name
# %z = UTC offset      %Z = timezone name
# %j = day of year     %U = week number (Sunday start)

# strptime — string to datetime (parsing)
print("\n--- strptime (parsing) ---")
parsed = datetime.strptime("2024-06-15 14:30:45", "%Y-%m-%d %H:%M:%S")
print(f"Parsed: {parsed} (naive — strptime doesn't add timezone)")

# fromisoformat — the PREFERRED way to parse ISO 8601 strings (3.7+)
# Much faster than strptime and handles timezone offsets
print("\n--- fromisoformat (preferred) ---")
iso_examples = [
    "2024-06-15",                        # date only
    "2024-06-15T14:30:45",               # naive datetime
    "2024-06-15T14:30:45+00:00",         # UTC
    "2024-06-15T14:30:45-04:00",         # EDT
    "2024-06-15T14:30:45.123456+00:00",  # with microseconds
]
for s in iso_examples:
    dt_parsed = datetime.fromisoformat(s)
    print(f"  {s:>40} -> tz={dt_parsed.tzinfo}")

# Epoch conversion
print("\n--- Epoch (Unix timestamp) ---")
epoch = dt.timestamp()
print(f"To epoch: {epoch}")
from_epoch = datetime.fromtimestamp(epoch, tz=timezone.utc)
print(f"From epoch: {from_epoch}")
# WARNING: datetime.fromtimestamp(epoch) without tz= returns NAIVE local time
# Always pass tz=timezone.utc

# isoformat is the best output format for APIs and storage
print(f"\nisoformat: {dt.isoformat()}")
```

#### timedelta Arithmetic and Pitfalls

```python
# run: python3 datetime_timedelta.py
"""timedelta arithmetic, pitfalls, and relativedelta alternative."""

from datetime import datetime, timedelta, timezone

now = datetime.now(timezone.utc)

# timedelta supports: weeks, days, hours, minutes, seconds, microseconds
delta_examples = [
    timedelta(days=30),
    timedelta(hours=2, minutes=30),
    timedelta(weeks=1),
    timedelta(seconds=86400),  # same as 1 day
    timedelta(days=-1),        # negative — go backward
]

for d in delta_examples:
    print(f"  {d!s:>30} = {d.total_seconds():>12.0f} seconds")

# Arithmetic
future = now + timedelta(days=90)
past = now - timedelta(hours=6)
print(f"\nNow:      {now.isoformat()}")
print(f"+90 days: {future.isoformat()}")
print(f"-6 hours: {past.isoformat()}")

# Multiplication and division
double = timedelta(hours=3) * 2    # 6 hours
half = timedelta(hours=3) / 2      # 1.5 hours
ratio = timedelta(hours=6) / timedelta(hours=2)  # 3.0 (float)
print(f"\n3h * 2 = {double}")
print(f"3h / 2 = {half}")
print(f"6h / 2h = {ratio}")

# PITFALL: timedelta has NO months or years parameter
# Because months and years have variable lengths!
# timedelta(months=1) — DOES NOT EXIST
# "One month from January 31" is ambiguous — February 28? March 1?

# WRONG: approximating months as 30 days
approx_month = now + timedelta(days=30)
print(f"\n30 days from now is NOT necessarily next month")

# RIGHT: use dateutil.relativedelta for month/year arithmetic
try:
    from dateutil.relativedelta import relativedelta

    next_month = now + relativedelta(months=1)
    next_year = now + relativedelta(years=1)
    print(f"\n+1 month (relativedelta): {next_month.isoformat()}")
    print(f"+1 year (relativedelta):  {next_year.isoformat()}")

    # relativedelta handles end-of-month correctly
    jan31 = datetime(2024, 1, 31, tzinfo=timezone.utc)
    feb_result = jan31 + relativedelta(months=1)
    print(f"\nJan 31 + 1 month = {feb_result.date()}")  # Feb 29 (2024 is leap year)

except ImportError:
    print("\ndateutil not installed — run: pip install python-dateutil")

# dateutil.parser — fuzzy date parsing (useful for user input)
try:
    from dateutil import parser

    fuzzy_dates = [
        "June 15, 2024",
        "15/06/2024",
        "2024-06-15T14:30:00Z",
        "next friday",  # relative dates may not work without additional context
    ]

    for date_str in fuzzy_dates:
        try:
            parsed = parser.parse(date_str)
            print(f"  {date_str:>30} -> {parsed}")
        except (ValueError, TypeError) as e:
            print(f"  {date_str:>30} -> FAILED: {e}")

except ImportError:
    print("\ndateutil not installed — run: pip install python-dateutil")
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Silent log loss from duplicate handlers**
A developer calls `logging.basicConfig()` at module import time AND configures logging via `dictConfig()` in the application startup. `basicConfig` has already attached a handler to the root logger. Now the root logger has two handlers, producing duplicate log lines. Or worse, the developer adds a handler inside a function that runs per-request — handlers accumulate over the lifetime of the process, memory grows, and every log message is emitted hundreds of times. **Symptom:** duplicate log lines that multiply over time, growing memory usage. **Fix:** use `dictConfig` exclusively, set `disable_existing_loggers: False`, and never call `basicConfig` in library code. Call `basicConfig` only in scripts where you control the entire process.

**2. Naive datetime arithmetic across DST boundaries**
A scheduling system stores meeting times as naive datetimes (no timezone). A meeting scheduled for "2:30 AM" on the day DST springs forward does not exist — clocks jump from 1:59 AM to 3:00 AM. The system either crashes, silently skips the meeting, or schedules it at the wrong wall-clock time. **Symptom:** recurring jobs fire at wrong times twice a year, time-based aggregations double-count or miss an hour. **Fix:** always store timestamps as aware UTC datetimes. Convert to local time only at the display layer. Use `zoneinfo` for DST-safe conversions.

**3. f-string formatting in hot logging paths**
A developer writes `logger.debug(f"Processing payload: {json.dumps(large_dict)}")` inside a per-request handler. Even though the log level in production is INFO (so debug messages are suppressed), the f-string is evaluated eagerly on every request. `json.dumps` on a large dictionary costs milliseconds — multiplied by thousands of requests per second, this adds measurable latency for log messages that are never emitted. **Symptom:** CPU profiling shows unexpected time in `json.dumps` or `__repr__` methods; latency increases when debug logging code is added but the level is not changed. **Fix:** use `logger.debug("Processing payload: %s", large_dict)` — the `%s` formatting is deferred and only executed if the message passes the level filter.
:::

## 🎯 Checkpoint

::: details Question 1 — Logger propagation
**Q:** You have three loggers: root (level WARNING, StreamHandler to stderr), `"myapp"` (level DEBUG, no handlers), and `"myapp.db"` (level INFO, FileHandler to `db.log`). A log record at level INFO is created on `"myapp.db"`. Trace exactly where this record goes — which handlers see it and which don't. What if the record is at level DEBUG?

**A:** For an INFO record on `"myapp.db"`:
1. The `"myapp.db"` logger checks its own level: INFO >= INFO, so the record passes.
2. The record is sent to `"myapp.db"`'s handler (FileHandler) — it appears in `db.log`.
3. Because `propagate` is True (default), the record propagates to `"myapp"`.
4. `"myapp"` has no handlers, but propagation continues upward.
5. The record reaches the root logger. Root's StreamHandler receives it. The handler's level is not explicitly set (defaults to NOTSET/0), so it passes. **Result:** the record appears in both `db.log` and stderr.

Wait — the root logger's level is WARNING. But logger levels only filter records *created at that logger*. When a record *propagates* to a parent, the parent's level is **not** rechecked (the effective level check already happened at the originating logger). So the root's WARNING level does not block the propagated INFO record. **The record appears in both db.log and stderr.**

For a DEBUG record: the `"myapp.db"` logger's level is INFO, and DEBUG < INFO. The record is suppressed immediately. No handler sees it.
:::

::: details Question 2 — Naive datetime bugs
**Q:** A cron job runs at midnight UTC and calculates "yesterday's revenue" by querying `WHERE created_at >= yesterday_start AND created_at < today_start`. The timestamps in the database are naive datetimes in the server's local timezone (US/Eastern). On November 3, 2024 (fall-back DST), the report shows incorrect revenue. Explain the bug and the fix.

**A:** On November 3, 2024, US/Eastern transitions from EDT (UTC-4) to EST (UTC-5) at 2:00 AM. The hour from 1:00 AM to 2:00 AM occurs twice — once in EDT, once in EST. Naive datetimes cannot distinguish between "1:30 AM EDT" and "1:30 AM EST."

The cron job calculates `yesterday_start` as `datetime(2024, 11, 2, 0, 0)` and `today_start` as `datetime(2024, 11, 3, 0, 0)`. Transactions during the ambiguous hour might be counted in the wrong day, or the query might miss/double-count the repeated hour. Additionally, "midnight UTC" is 8 PM Eastern (EDT) on Nov 2 or 7 PM Eastern (EST) on Nov 3, so the boundaries do not align with calendar dates in either timezone.

Fix: (1) Store all timestamps as UTC-aware datetimes in the database. (2) Calculate date boundaries in UTC: `yesterday_start = datetime(2024, 11, 2, tzinfo=timezone.utc)`. (3) If you must report in local time, use `zoneinfo` for DST-aware boundary calculation: convert local midnight to UTC using `ZoneInfo("America/New_York")`, which correctly handles the DST transition.
:::

::: details Question 3 — Lazy logging performance
**Q:** Why does `logger.debug("Value: %s", expensive_object)` avoid the performance cost of formatting when debug is disabled, while `logger.debug(f"Value: {expensive_object}")` does not? Trace the execution for both cases when the logger's level is INFO.

**A:** With `logger.debug(f"Value: {expensive_object}")`: Python evaluates the f-string *before* calling `logger.debug()`. This triggers `expensive_object.__repr__()` (or `__str__()` or `__format__()`) to produce the string interpolation. The fully formatted string is then passed to `logger.debug()`. Inside `debug()`, the logger checks `self.isEnabledFor(DEBUG)` and sees that DEBUG < INFO, so it returns immediately without creating a LogRecord. But the damage is done — the expensive formatting already happened.

With `logger.debug("Value: %s", expensive_object)`: Python passes the raw format string `"Value: %s"` and `expensive_object` as separate arguments to `logger.debug()`. Inside `debug()`, the `isEnabledFor` check fails (DEBUG < INFO), and the method returns immediately. The `%s` formatting — which would call `str(expensive_object)` — is never executed because it only happens during `LogRecord.getMessage()`, which is only called when a handler actually needs to emit the record. The object is not converted to a string at all.
:::

## Key Mental Models

- **Loggers are a tree; handlers are the leaves.** Records flow up the tree via propagation. Each node (logger) decides whether a record is loud enough to pass. Each leaf (handler) decides where to write it. Configure the tree once at application startup; never in libraries.

- **Lazy formatting is not style — it is a performance contract.** `logger.debug("x=%s", x)` defers `str(x)` until the message is actually emitted. `f"x={x}"` pays the formatting cost unconditionally. In hot paths with expensive `__repr__`, this is the difference between 0 and measurable latency.

- **Naive datetimes are bugs in disguise.** A datetime without a timezone is like a price without a currency. It looks correct until you cross a boundary (timezone, DST transition, server migration) and discover it was ambiguous all along. Always use `datetime.now(timezone.utc)`.

- **UTC is for storage and computation; local time is for display.** Store and transmit in UTC. Convert to the user's timezone only at the presentation layer. This eliminates DST bugs, cross-server inconsistencies, and ambiguous-time comparisons.

- **timedelta does not know about months or years.** Months have 28-31 days; years have 365-366. `timedelta` only deals in fixed durations (days, seconds, microseconds). For calendar arithmetic, use `dateutil.relativedelta`.

## Related

- [Module 6 — Error Handling](/python/module-06/) — exception handling in logging contexts (exc_info parameter, traceback formatting)
- [Module 7 — Concurrency](/python/module-07/) — thread-safe logging, logging from async contexts
- [Serialization — json, pickle & struct](./02-serialization.md) — JSON serialization of datetime objects (the most common serialization pain point)
- [pathlib & OS Interaction](./01-pathlib-os.md) — FileHandler paths, log file rotation and management
