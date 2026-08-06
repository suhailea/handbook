---
title: Virtual Environments & Modern Packaging
outline: deep
---

# Virtual Environments & Modern Packaging

**Interview weight:** 🔥🔥 — Packaging rarely gets deep interview questions, but dependency isolation problems are daily production headaches. Knowing the mechanics lets you debug "it works on my machine" issues in minutes instead of hours.

**Python version notes:** `venv` module is 3.3+. `pyproject.toml` support via PEP 517/518 is 3.6+ (with build tool support). PEP 621 (project metadata in `pyproject.toml`) is widely supported since 2021. `uv` is a 2024+ tool. Examples target Python 3.12+.

**Prerequisites:** [How import Actually Works](./01-import-mechanics.md) (sys.path, site-packages, how Python finds modules).

## 🗣️ In Plain English

::: tip In Plain English
A virtual environment is like a sealed terrarium for your project. Each terrarium has its own soil (a link to a Python interpreter), its own plants (installed packages), and its own label (the activate script that tells your shell "use THIS terrarium"). Without terrariums, all your projects share one garden — and when Project A needs version 1 of a plant and Project B needs version 2, they rip each other's plants out.

When you create a terrarium (`python -m venv .venv`), Python does not copy the entire interpreter — that would be wasteful. Instead, it creates a lightweight structure: a symlink to the real Python, a fresh empty plot for plants (the `site-packages` directory), and a configuration card (`pyvenv.cfg`) that says "I belong to this Python version, and here is my soil."

"Activating" the terrarium does not cast a spell on your computer. It simply puts a sign on your workbench that says "look in THIS terrarium first." Technically, it prepends the terrarium's `bin/` directory to your shell's `PATH`, so when you type `python` or `pip`, the shell finds the terrarium's copies first. Deactivating just removes the sign.

Installing a plant (`pip install requests`) is a multi-step process: the gardener (pip) reads the plant's label to figure out what other plants it needs (dependency resolution), fetches the right seeds from the nursery (PyPI), unpacks them (builds or extracts a wheel), and plants them in the terrarium's plot (copies files into `site-packages`). If the plant comes as a pre-potted cutting (a wheel — a `.whl` file), planting is fast. If it comes as raw seeds (a source distribution — `.tar.gz`), the gardener has to grow it first (compile C extensions, run build scripts), which takes longer and may need extra tools.

The modern way to describe your terrarium's layout — what plants it needs, what version of soil, what label it has — is a single card called `pyproject.toml`. Older projects used `setup.py` (a Python script, flexible but dangerous) or `setup.cfg` (a config file, safer but limited). The community is converging on `pyproject.toml` as the one card to rule them all.
:::

## ⚙️ Under the Hood

### Why Virtual Environments Exist

Without isolation, `pip install` places packages in the system-wide or user-wide `site-packages`. This creates conflicts:

- Project A needs `requests==2.28`, Project B needs `requests==2.31`
- Only one version can exist in a single `site-packages`
- Upgrading for one project breaks the other

Virtual environments solve this by giving each project its own `site-packages` directory.

### What `python -m venv` Creates

```python
# run: python3 venv_structure.py
import subprocess
import os
import tempfile
import shutil

tmp = tempfile.mkdtemp()
venv_dir = os.path.join(tmp, ".venv")

# Create a virtual environment
subprocess.run(["python3", "-m", "venv", venv_dir], check=True)

# Show the structure
for root, dirs, files in os.walk(venv_dir):
    # Skip __pycache__ and deep site-packages internals
    dirs[:] = [d for d in dirs if d != "__pycache__" and d != "distutils"]
    level = root.replace(venv_dir, "").count(os.sep)
    indent = "  " * level
    print(f"{indent}{os.path.basename(root)}/")
    if level < 3:  # Don't go too deep
        for f in files[:5]:
            print(f"{indent}  {f}")
        if len(files) > 5:
            print(f"{indent}  ... and {len(files) - 5} more files")

shutil.rmtree(tmp)
```

The key components:

| Path | Purpose |
|------|---------|
| `pyvenv.cfg` | Configuration: `home` (path to base Python), `include-system-site-packages` (usually `false`) |
| `bin/python` (or `Scripts\python.exe`) | Symlink (or copy on Windows) to the base Python interpreter |
| `bin/pip` | pip configured to install into this venv's site-packages |
| `bin/activate` | Shell script that modifies `PATH` and sets `VIRTUAL_ENV` |
| `lib/python3.12/site-packages/` | Empty directory where packages will be installed |

```python
# run: python3 pyvenv_cfg.py
import subprocess
import os
import tempfile
import shutil

tmp = tempfile.mkdtemp()
venv_dir = os.path.join(tmp, ".venv")
subprocess.run(["python3", "-m", "venv", venv_dir], check=True)

# Read pyvenv.cfg
cfg_path = os.path.join(venv_dir, "pyvenv.cfg")
with open(cfg_path) as f:
    print("pyvenv.cfg contents:")
    print(f.read())

# Show symlink
python_path = os.path.join(venv_dir, "bin", "python")
if os.path.islink(python_path):
    print(f"bin/python -> {os.readlink(python_path)}")

shutil.rmtree(tmp)
```

### Activation: What Actually Happens

`source .venv/bin/activate` is just a shell script that does two things:

1. **Prepends `.venv/bin/` to `PATH`** — so `python`, `pip`, and any installed console scripts resolve to the venv's copies first
2. **Sets `VIRTUAL_ENV` environment variable** — used by tools (not by Python itself) to detect venv context

```bash
# What activate essentially does (simplified):
export VIRTUAL_ENV="/path/to/.venv"
export PATH="$VIRTUAL_ENV/bin:$PATH"
```

**You do not need to activate a venv to use it.** You can always call the venv's Python directly:

```python
# run: python3 no_activate.py
import subprocess
import os
import tempfile
import shutil
import sys

tmp = tempfile.mkdtemp()
venv_dir = os.path.join(tmp, ".venv")
subprocess.run([sys.executable, "-m", "venv", venv_dir], check=True)

venv_python = os.path.join(venv_dir, "bin", "python")

# This uses the venv's Python without activation
result = subprocess.run(
    [venv_python, "-c", "import sys; print(sys.prefix)"],
    capture_output=True, text=True
)
print(f"sys.prefix (venv): {result.stdout.strip()}")
print(f"sys.prefix (current): {sys.prefix}")
# They differ — the venv Python uses its own prefix

shutil.rmtree(tmp)
```

### `pip install` Step by Step

When you run `pip install requests`:

```
1. RESOLVE dependencies
   ├─ Parse requirements (requests, version constraints)
   ├─ Query PyPI API for available versions
   ├─ Build dependency tree (requests needs urllib3, charset-normalizer, etc.)
   └─ Resolve conflicts (find compatible version set)

2. DOWNLOAD
   ├─ Check local cache (~/.cache/pip/) first
   ├─ Download .whl (wheel) if available for this platform
   └─ Download .tar.gz (sdist) as fallback

3. BUILD (only for sdist)
   ├─ Extract archive
   ├─ Run build backend (setuptools, flit, hatchling)
   ├─ Compile C extensions if any
   └─ Produce a .whl

4. INSTALL
   ├─ Extract .whl (it's a zip file) into site-packages/
   ├─ Write .dist-info/ metadata directory
   └─ Install console_scripts entry points into bin/
```

```python
# run: python3 pip_internals.py
import subprocess
import sys

# Show pip's verbose output for a small package install (dry run)
result = subprocess.run(
    [sys.executable, "-m", "pip", "install", "--dry-run", "--verbose", "six"],
    capture_output=True, text=True
)
# Print just the interesting lines
for line in result.stdout.splitlines():
    if any(kw in line.lower() for kw in ["collecting", "using cached", "found", "would"]):
        print(line.strip())
```

### Requirements Files

```python
# run: python3 requirements_demo.py
# Demonstrates the format of requirements.txt

requirements_txt = """\
# Pinned versions (from pip freeze)
requests==2.31.0
urllib3==2.1.0
certifi==2023.11.17

# Flexible constraints
flask>=3.0,<4.0
sqlalchemy~=2.0.0       # Compatible release: >=2.0.0, <2.1.0

# From a URL
# git+https://github.com/user/repo.git@main#egg=mypackage

# From a local path
# -e ./my-local-package
"""

print("Example requirements.txt:")
print(requirements_txt)

# pip freeze produces pinned output
import subprocess, sys
result = subprocess.run(
    [sys.executable, "-m", "pip", "freeze"],
    capture_output=True, text=True
)
print("Current pip freeze output (first 5 lines):")
for line in result.stdout.strip().splitlines()[:5]:
    print(f"  {line}")
```

**The problem with requirements.txt:** it captures direct and transitive dependencies in a flat list, but it does not distinguish between them and does not record *why* each version was chosen. Lock files solve this.

### `pyproject.toml` — The Modern Config File

`pyproject.toml` (PEP 517/518/621) replaces `setup.py` and `setup.cfg` as the single configuration file for Python projects.

```toml
# Example pyproject.toml — a complete modern project config

[build-system]
# PEP 518: declares what tools are needed to BUILD this package
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
# PEP 621: standardized project metadata
name = "my-library"
version = "1.0.0"
description = "A demonstration library"
readme = "README.md"
license = {text = "MIT"}
requires-python = ">=3.12"
authors = [
    {name = "Author Name", email = "author@example.com"},
]
dependencies = [
    "requests>=2.28",
    "pydantic>=2.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "ruff>=0.3",
    "mypy>=1.8",
]

[project.scripts]
# Console entry points — creates executable commands on install
my-cli = "my_library.cli:main"

[project.urls]
Homepage = "https://github.com/user/my-library"
Documentation = "https://my-library.readthedocs.io"

[tool.ruff]
# Tool-specific configuration lives under [tool.*]
line-length = 88
target-version = "py312"

[tool.mypy]
strict = true

[tool.pytest.ini_options]
testpaths = ["tests"]
```

```python
# run: python3 parse_pyproject.py
# Reading a pyproject.toml programmatically

import tomllib  # Python 3.11+ standard library

toml_content = """
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "demo"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = ["requests>=2.28", "click>=8.0"]

[project.optional-dependencies]
dev = ["pytest", "ruff"]
"""

config = tomllib.loads(toml_content)
print(f"Build backend: {config['build-system']['build-backend']}")
print(f"Project name:  {config['project']['name']}")
print(f"Dependencies:  {config['project']['dependencies']}")
print(f"Dev deps:      {config['project']['optional-dependencies']['dev']}")
```

### The Evolution: setup.py to setup.cfg to pyproject.toml

| Era | File | Format | Pros | Cons |
|-----|------|--------|------|------|
| 2000s | `setup.py` | Python script | Full power of Python, arbitrary logic | Arbitrary code execution on install, hard to parse statically, security risk |
| 2016 | `setup.cfg` | INI-style config | Declarative, no code execution | Still needs `setup.py` stub, limited expressiveness, setuptools-specific |
| 2020s | `pyproject.toml` | TOML | Standardized (PEP 621), build-system agnostic, one file for everything | Relatively new, some old tools don't support it |

**Today's recommendation:** use `pyproject.toml` for all new projects. There is no reason to create `setup.py` or `setup.cfg` for new work.

### Lock Files: Reproducible Installs

A lock file records the **exact** versions of every dependency (direct and transitive) along with their hashes. This guarantees that `pip install` produces identical environments across machines and time.

| Tool | Lock file | Command to generate | Command to install |
|------|-----------|--------------------|--------------------|
| pip-tools | `requirements.lock` (or `requirements.txt`) | `pip-compile pyproject.toml -o requirements.lock` | `pip install -r requirements.lock` |
| Poetry | `poetry.lock` | `poetry lock` | `poetry install` |
| uv | `uv.lock` | `uv lock` | `uv sync` |
| pip (native) | `pip freeze > r.txt` | `pip freeze` | `pip install -r r.txt` (no hash verification) |

```python
# run: python3 lock_concept.py
# Illustrating why lock files matter

# Without a lock file:
# requirements.txt says: requests>=2.28
# On Monday, pip resolves to requests==2.31.0, urllib3==2.1.0
# On Friday, urllib3 2.2.0 is released
# pip resolves to requests==2.31.0, urllib3==2.2.0
# Your tests break because urllib3 changed behavior

# With a lock file:
# lock file says:
#   requests==2.31.0 sha256:abc123...
#   urllib3==2.1.0    sha256:def456...
# Both Monday and Friday get the EXACT same versions
# You upgrade explicitly, not accidentally

print("Lock files solve: 'it works on my machine' by pinning exact versions + hashes")
print("Generate: pip-compile / poetry lock / uv lock")
print("Install:  pip install -r requirements.lock / poetry install / uv sync")
```

### uv: The Modern Rust-Based Package Manager

`uv` (by Astral, the makers of `ruff`) is a drop-in replacement for pip, pip-tools, virtualenv, and more. It is written in Rust and is typically 10-100x faster than pip.

```python
# run: python3 uv_overview.py
# Overview of uv commands (not executed, just documented)

commands = {
    "uv venv":           "Create a virtual environment (10x faster than python -m venv)",
    "uv pip install X":  "Install packages (drop-in pip replacement, 10-100x faster)",
    "uv pip compile":    "Generate a lock file from requirements.in or pyproject.toml",
    "uv pip sync":       "Install exactly what's in the lock file (add/remove as needed)",
    "uv lock":           "Generate uv.lock from pyproject.toml (project-level workflow)",
    "uv sync":           "Create/update venv to match uv.lock",
    "uv run script.py":  "Run a script in the project's venv (auto-creates if needed)",
    "uv add requests":   "Add a dependency to pyproject.toml and update uv.lock",
    "uv remove requests":"Remove a dependency from pyproject.toml and update uv.lock",
    "uv tool install ruff": "Install a CLI tool globally in an isolated environment",
}

print("uv command reference:")
for cmd, desc in commands.items():
    print(f"  {cmd:<30s} {desc}")

print("\nWhy is uv faster?")
print("  1. Rust — no interpreter startup overhead")
print("  2. Parallel downloads and installs")
print("  3. Global cache with hardlinks (no redundant copies)")
print("  4. Built-in resolver (no shelling out to pip)")
```

### Wheels vs Source Distributions

| | Wheel (`.whl`) | Source dist (`.tar.gz` / sdist) |
|---|---|---|
| **Format** | ZIP archive with pre-built files | Archive of source code |
| **Extension** | `.whl` (e.g., `requests-2.31.0-py3-none-any.whl`) | `.tar.gz` |
| **Install speed** | Fast — just extract files | Slow — must run build step |
| **C extensions** | Pre-compiled for platform | Must compile (needs compiler + headers) |
| **Platform-specific?** | Can be (`cp312-manylinux_x86_64`) or universal (`py3-none-any`) | Always platform-independent (but build may fail) |
| **Name format** | `{name}-{ver}-{python}-{abi}-{platform}.whl` | `{name}-{ver}.tar.gz` |

```python
# run: python3 wheel_anatomy.py
# A wheel is just a zip file — let's look inside one

import subprocess
import sys
import zipfile
import tempfile
import os
import shutil

tmp = tempfile.mkdtemp()

# Download a wheel without installing it
subprocess.run(
    [sys.executable, "-m", "pip", "download", "--no-deps",
     "--dest", tmp, "--only-binary=:all:", "six"],
    capture_output=True, check=True
)

# Find the .whl file
whl_files = [f for f in os.listdir(tmp) if f.endswith(".whl")]
if whl_files:
    whl_path = os.path.join(tmp, whl_files[0])
    print(f"Wheel file: {whl_files[0]}")
    print(f"\nContents:")
    with zipfile.ZipFile(whl_path) as zf:
        for name in sorted(zf.namelist()):
            print(f"  {name}")

shutil.rmtree(tmp)
```

### Publishing to PyPI

The modern publishing workflow:

```python
# run: python3 publish_steps.py
# Steps to publish a package (documented, not executed)

steps = """
1. CONFIGURE pyproject.toml
   - Set [build-system], [project] metadata
   - Ensure version is bumped

2. BUILD
   $ python -m build
   # Creates dist/my_library-1.0.0.tar.gz  (sdist)
   #    and dist/my_library-1.0.0-py3-none-any.whl  (wheel)

3. CHECK (optional but recommended)
   $ twine check dist/*
   # Validates metadata and README rendering

4. UPLOAD
   $ twine upload dist/*
   # Uploads to PyPI (requires API token or trusted publishing)

5. TRUSTED PUBLISHING (modern, recommended)
   - Configure on PyPI: link your GitHub repo
   - GitHub Actions workflow uses pypa/gh-action-pypi-publish
   - No API tokens needed — OIDC-based authentication
   - The workflow builds and publishes on git tag push
"""

print(steps)
```

### Editable Installs: Development Mode

`pip install -e .` installs a package in "editable" (development) mode. Instead of copying files into `site-packages`, it creates a link so that changes to the source are immediately reflected without reinstalling.

```python
# run: python3 editable_demo.py
import os
import sys
import subprocess
import tempfile
import shutil

tmp = tempfile.mkdtemp()

# Create a minimal package
pkg_dir = os.path.join(tmp, "mylib")
src_dir = os.path.join(pkg_dir, "src", "mylib")
os.makedirs(src_dir)

with open(os.path.join(src_dir, "__init__.py"), "w") as f:
    f.write("VERSION = '1.0'\n")

with open(os.path.join(pkg_dir, "pyproject.toml"), "w") as f:
    f.write("""\
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "mylib"
version = "1.0"
""")

print("Package structure:")
for root, dirs, files in os.walk(pkg_dir):
    dirs[:] = [d for d in dirs if d != "__pycache__"]
    level = root.replace(pkg_dir, "").count(os.sep)
    print(f"{'  ' * level}{os.path.basename(root)}/")
    for f in files:
        print(f"{'  ' * (level + 1)}{f}")

print("\nEditable install: pip install -e .")
print("  Creates a .pth file or __editable__.py in site-packages")
print("  Source changes are immediately visible without reinstall")
print("  Used during development — never for production deployment")

shutil.rmtree(tmp)
```

**How it works:** Modern build backends (hatchling, setuptools>=64) create either a `.pth` file or an `__editable___*.py` finder that adds your source directory to `sys.path`. Older setuptools used `egg-link` files. The result is the same: `import mylib` loads from your source directory, not from a copy in `site-packages`.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Missing system dependencies for C-extension wheels**

Symptom: `pip install psycopg2` fails in a Docker build with `Error: pg_config executable not found` or `gcc: command not found`. Root cause: `psycopg2` ships a source distribution that needs the PostgreSQL client libraries and a C compiler to build. The pre-built wheel (`psycopg2-binary`) exists but is not recommended for production by the maintainers. Fix: install system dependencies in your Dockerfile (`apt-get install libpq-dev gcc`) before `pip install`, or use `psycopg[binary]` (the new pure-Python + C-accelerated approach in psycopg 3). In general, always check whether a package has a binary wheel for your platform (`manylinux`, `musllinux` for Alpine).

**2. Dependency resolution conflicts causing unreproducible builds**

Symptom: `pip install` works today, fails next week with `ERROR: Cannot install X and Y because they have conflicting dependencies`. Or worse: it succeeds both times but installs different transitive dependency versions, and the application behaves differently. Root cause: no lock file. `requirements.txt` with `>=` constraints allows pip to resolve differently each time. Fix: use a lock file (`uv lock` / `pip-compile`) and install from it (`uv sync` / `pip-sync`). Pin everything, including transitive dependencies. Run resolution in CI to catch conflicts early.

**3. Forgetting to exclude venv from Docker images / git**

Symptom: Docker image is 2 GB instead of 200 MB; git push takes forever; CI builds re-download everything because the venv from a different OS is included. Root cause: the `.venv/` directory (with compiled `.so` files for the developer's OS) was copied into the Docker build context or committed to git. Fix: add `.venv/` to `.dockerignore` and `.gitignore`. In Dockerfiles, use multi-stage builds: install dependencies in a builder stage, copy only the installed packages (or use `--mount=type=cache` for pip).

:::

## 🎯 Checkpoint

::: details Question 1 — What does activation actually do?
**Q:** You activate a virtual environment with `source .venv/bin/activate`. What specific changes does this make to your shell? Could you use the venv without activating it?

**A:** Activation does two things: (1) prepends `.venv/bin/` to the `PATH` environment variable so that `python`, `pip`, and installed console scripts resolve to the venv's copies; (2) sets the `VIRTUAL_ENV` environment variable to the venv's directory (used by tooling for detection, not by Python itself). You absolutely can use a venv without activating it — just call `.venv/bin/python` or `.venv/bin/pip` directly with the full path. Python determines its `sys.prefix` (and therefore its `site-packages` location) from the location of the binary, not from environment variables. Activation is purely a shell convenience.
:::

::: details Question 2 — Why lock files, not just pip freeze?
**Q:** `pip freeze > requirements.txt` pins exact versions. Why do teams still use dedicated lock file tools like `pip-compile` or `uv lock`?

**A:** `pip freeze` dumps a flat list of every installed package with its exact version, but it has several shortcomings: (1) it does not distinguish direct dependencies from transitive ones — you cannot tell which packages you explicitly asked for vs. which were pulled in automatically; (2) it does not record cryptographic hashes, so you cannot verify that the downloaded files match what was originally resolved; (3) it does not record dependency relationships, so removing a direct dependency does not tell you which transitive dependencies can be safely removed; (4) it captures whatever is currently installed, including packages installed for debugging or other projects that leaked in. Lock file tools like `pip-compile` start from your declared dependencies (in `pyproject.toml` or `requirements.in`), resolve the full dependency tree, record hashes, and mark which dependencies are direct vs. transitive. This makes installs reproducible, verifiable, and auditable.
:::

::: details Question 3 — Wheels vs sdist for deployment
**Q:** Your CI pipeline builds a Docker image with `pip install .` for a pure-Python package. Should you build a wheel first and install that, or install directly from source? Why?

**A:** Build a wheel first (`python -m build --wheel`) and install the `.whl` file. Reasons: (1) installing a wheel is just unzipping files into `site-packages` — it is fast and deterministic; (2) installing from source requires running the build backend (setuptools/hatchling), which is slower and introduces another failure point; (3) the wheel is a self-contained artifact you can test, cache, and reuse across environments; (4) for packages with C extensions, building the wheel once (in a builder stage) and installing it in the final image avoids needing compilers in production images. The pattern in Dockerfiles is: build the wheel in a builder stage, copy the `.whl` to the final stage, `pip install *.whl`.
:::

## Key Mental Models

- **A venv is a `sys.path` trick, not a copy of Python.** It creates a fresh `site-packages` and a symlink to the system Python. Activation is just a `PATH` change — you can always call `.venv/bin/python` directly.

- **`pip install` is resolve, download, build, extract.** The build step (sdist to wheel) is where most failures happen. Prefer pre-built wheels. Use lock files to make resolution reproducible.

- **`pyproject.toml` is the single config file.** It declares the build system (`[build-system]`), the project metadata (`[project]`), and tool configuration (`[tool.*]`). There is no reason to create `setup.py` for new projects.

- **Lock files pin the world; requirements.txt pins a snapshot.** Lock files record direct vs. transitive dependencies, hashes, and the resolution graph. Plain `pip freeze` gives you a flat list with none of that context.

- **`uv` is the modern default.** It replaces `pip`, `pip-tools`, and `virtualenv` with a single tool that is 10-100x faster due to Rust, parallelism, and global caching with hardlinks.

## Related

- [How import Actually Works](./01-import-mechanics.md) — `sys.path` is the bridge between packaging and imports; `pip install` puts files where `sys.path` can find them.
- [Module 1 — What Python Is](/python/module-01/01-what-python-is.md) — the CPython interpreter that venvs symlink to.
- [Module 12 — Testing & Tooling](/python/module-12/) — testing tools configured via `pyproject.toml`, CI/CD pipelines that build and publish packages.
