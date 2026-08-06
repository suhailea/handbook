---
title: Module 11 Summary
outline: deep
---

# Module 11 Summary — Standard Library Power Tools

You have covered the standard library modules that form the backbone of everyday backend Python: filesystem operations, serialization, logging, and datetime handling. These tools are not exciting individually, but misusing any one of them produces security vulnerabilities, data corruption, or silent bugs that surface months later.

## Mental Models Gained

1. **Paths are objects, not strings.** `pathlib.Path` eliminates manual slash concatenation, platform differences, and an entire class of bugs. The `/` operator for joining and `.resolve()` for canonicalization replace fragile string manipulation.

2. **resolve() before authorize.** Never make access-control decisions based on the user-supplied path. Canonicalize with `.resolve()` first to neutralize `..`, `.`, and symlinks, then check that the result is within your allowed directory.

3. **subprocess: list is safe, shell string is dangerous.** Passing commands as a list of arguments prevents shell injection the same way parameterized queries prevent SQL injection. `shell=True` with user input is always a vulnerability.

4. **Serialization is a trust boundary.** Data that crosses a serialization/deserialization boundary must be treated as untrusted. JSON is safe (it can only produce inert data). Pickle is a VM that executes arbitrary code — never unpickle untrusted data.

5. **JSON supports exactly 6 types.** Everything else (datetime, Decimal, bytes, sets, custom classes) requires a custom encoder. Plan your serialization strategy upfront; do not discover type errors in production.

6. **Loggers are a tree; records propagate up.** Configure the tree once at application startup via `dictConfig`. Each module gets its own logger via `getLogger(__name__)`. Never call `basicConfig` in library code.

7. **Lazy log formatting is a performance contract.** `logger.debug("x=%s", x)` defers formatting until the message passes level filters. `f"x={x}"` pays the cost unconditionally. In hot paths, this difference is measurable.

8. **Naive datetimes are bugs waiting to happen.** Always use `datetime.now(timezone.utc)`. Store and transmit in UTC. Convert to local time only for display. Use `zoneinfo` for DST-aware conversions.

## Self-Assessment Checklist

Before moving on, verify you can answer or demonstrate each of these:

- [ ] Create a `pathlib.Path`, join segments with `/`, and extract `.name`, `.stem`, `.suffix`, `.parent`
- [ ] Use `.resolve()` to prevent path traversal and explain why string-checking for `..` is insufficient
- [ ] Use `shutil.copytree()`, `shutil.move()`, and `shutil.make_archive()` for bulk file operations
- [ ] Explain why `tempfile.NamedTemporaryFile` is more secure than manually creating `/tmp/myapp.txt`
- [ ] Run an external command with `subprocess.run()` using a list of arguments, and explain why `shell=True` with user input is a vulnerability
- [ ] Serialize a Python dict with `datetime` and `Decimal` values to JSON using a custom `default` function
- [ ] Explain the `pickle.__reduce__` attack and why pickle cannot be "fixed" for untrusted data
- [ ] Use `struct.pack()` and `struct.unpack()` to create and parse a binary protocol header
- [ ] Configure logging with `dictConfig`: multiple loggers, handlers, and formatters
- [ ] Explain logger propagation: trace a log record from a child logger through parent loggers to the root
- [ ] Create an aware datetime in UTC, convert it to another timezone with `astimezone()`, and explain why naive datetimes break at DST boundaries
- [ ] Use lazy formatting (`logger.info("x=%s", x)`) and explain why f-strings in log calls can cause performance issues

## Quick Reference

### pathlib.Path — Common Methods

| Method / Property | Returns | Description |
|-------------------|---------|-------------|
| `Path("a") / "b"` | `Path` | Join path segments |
| `.name` | `str` | Final component (`"file.tar.gz"`) |
| `.stem` | `str` | Name without last suffix (`"file.tar"`) |
| `.suffix` | `str` | Last suffix (`".gz"`) |
| `.suffixes` | `list[str]` | All suffixes (`[".tar", ".gz"]`) |
| `.parent` | `Path` | Parent directory |
| `.parts` | `tuple[str, ...]` | All components as tuple |
| `.resolve()` | `Path` | Absolute path, symlinks resolved |
| `.exists()` | `bool` | Path exists on filesystem |
| `.is_file()` | `bool` | Is a regular file |
| `.is_dir()` | `bool` | Is a directory |
| `.mkdir(parents, exist_ok)` | `None` | Create directory (and parents) |
| `.iterdir()` | `Iterator[Path]` | Iterate direct children |
| `.glob(pattern)` | `Iterator[Path]` | Match pattern in directory |
| `.rglob(pattern)` | `Iterator[Path]` | Recursive glob |
| `.read_text(encoding)` | `str` | Read entire file as string |
| `.write_text(data, encoding)` | `int` | Write string to file |
| `.read_bytes()` | `bytes` | Read entire file as bytes |
| `.write_bytes(data)` | `int` | Write bytes to file |
| `.unlink()` | `None` | Delete file |
| `.with_suffix(s)` | `Path` | Replace last suffix |
| `.with_name(n)` | `Path` | Replace final component |
| `.is_relative_to(other)` | `bool` | True if path is relative to other (3.9+) |

### json vs pickle Comparison

| Aspect | `json` | `pickle` |
|--------|--------|----------|
| Format | Text (UTF-8) | Binary |
| Language support | Universal | Python only |
| Supported types | 6 primitives | Almost any Python object |
| Security | Safe for untrusted data | **UNSAFE** — arbitrary code execution |
| Human-readable | Yes | No (except protocol 0) |
| Custom types | Requires encoder/decoder | Automatic via `__reduce__` |
| Speed | Moderate | Faster for complex objects |
| File extension | `.json` | `.pkl`, `.pickle` |
| Use case | APIs, config, storage | Caching, internal IPC only |

### Logging Levels

| Level | Value | When to Use |
|-------|-------|-------------|
| `DEBUG` | 10 | Detailed diagnostic info (variable values, flow tracing) |
| `INFO` | 20 | Confirmation that things work as expected |
| `WARNING` | 30 | Something unexpected but not an error (yet) |
| `ERROR` | 40 | A specific operation failed |
| `CRITICAL` | 50 | The program may not be able to continue |

### datetime Format Codes (strftime / strptime)

| Code | Meaning | Example |
|------|---------|---------|
| `%Y` | 4-digit year | `2024` |
| `%m` | Zero-padded month | `06` |
| `%d` | Zero-padded day | `15` |
| `%H` | 24-hour hour | `14` |
| `%I` | 12-hour hour | `02` |
| `%M` | Minute | `30` |
| `%S` | Second | `45` |
| `%p` | AM/PM | `PM` |
| `%A` | Full weekday name | `Saturday` |
| `%B` | Full month name | `June` |
| `%z` | UTC offset | `+0000` |
| `%Z` | Timezone name | `UTC` |
| `%j` | Day of year | `167` |
| `%f` | Microsecond | `000000` |

### ISO 8601 — The Only Date Format You Should Use for APIs

```
2024-06-15T14:30:45.123456+00:00
│          │            │      │
│          │            │      └── UTC offset
│          │            └── microseconds
│          └── time (HH:MM:SS)
└── date (YYYY-MM-DD)
```

## Next Module

[Module 12 — Testing & Tooling](/python/module-12/) covers `unittest`, `pytest`, mocking, coverage, linting, formatting, and building a professional Python development workflow.
