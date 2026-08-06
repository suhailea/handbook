---
title: Module 11 — Standard Library Power Tools
outline: deep
---

# Module 11 — Standard Library Power Tools

Python's standard library is famously "batteries included." But having batteries and knowing which ones to grab in the dark are different skills. This module focuses on the standard library modules that show up most often in production backend code and in interviews: filesystem operations, serialization, logging, and time handling.

These are not glamorous topics. They are the plumbing that every real application relies on. Misuse a path join and you have a security vulnerability. Serialize with pickle from untrusted input and you have remote code execution. Use naive datetimes and your billing system charges users in the wrong timezone. Configure logging wrong and your midnight pages produce walls of unhelpful text.

Each page in this module covers a cluster of related standard library modules, explaining not just the API surface but *why* the design is the way it is, where the sharp edges hide, and what production failures look like when you get it wrong.

## What You'll Learn

- **Filesystem & OS interaction** — `pathlib` as the modern path API, `shutil` for high-level operations, `tempfile` for secure temporary storage, `subprocess` for running external commands safely, and why `shell=True` is a loaded gun.
- **Serialization** — `json` for interoperable data exchange, `pickle` for Python-specific serialization (and why it is a security hazard), `struct` for binary data, and how `dataclasses` fit into the serialization picture.
- **Logging & datetime** — the logging module's architecture (loggers, handlers, formatters, filters, propagation), configuration via `dictConfig`, structured logging for production, and the full datetime stack including timezone handling with `zoneinfo`.

## Pages in This Module

| # | Page | Focus |
|---|------|-------|
| 1 | [pathlib & OS Interaction](./01-pathlib-os.md) | `pathlib.Path`, `shutil`, `tempfile`, `subprocess`, environment variables, safe command execution |
| 2 | [Serialization — json, pickle & struct](./02-serialization.md) | JSON encoding/decoding, custom serializers, pickle mechanics and security, `struct` for binary data, dataclasses + JSON |
| 3 | [Logging & Datetime](./03-logging-datetime.md) | Logger hierarchy, handlers, `dictConfig`, structured logging, `datetime`/`zoneinfo`, naive vs aware, `dateutil` |

## Prerequisites

- **[Module 1 — The Data Model](/python/module-01/)**: Context managers (`with` statements) are used throughout for tempfiles, subprocesses, and file I/O. Dunder methods underpin custom serialization.
- **[Module 3 — Functions & Scoping](/python/module-03/)**: Higher-order functions and closures appear in custom JSON encoders and log filters.
- **[Module 4 — OOP & Descriptors](/python/module-04/)**: Subclassing is used for custom JSON encoders, log filters, and understanding the logging hierarchy.
- **[Module 6 — Error Handling](/python/module-06/)**: Exception handling is central to subprocess management, file operations, and understanding what happens when serialization fails.

## How the Pages Connect

Filesystem operations (page 1) produce and consume the data that serialization (page 2) transforms for storage and transmission. Logging (page 3) records what happens during both of those operations. The `pathlib.Path` you construct in page 1 might point to the JSON file you serialize in page 2, whose write operation you log in page 3. Together, these three pages cover the standard library surface area that a backend engineer touches every day.
