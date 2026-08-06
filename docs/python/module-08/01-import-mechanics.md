---
title: How import Actually Works
outline: deep
---

# How import Actually Works

**Interview weight:** 🔥🔥 — Understanding import mechanics separates "I write Python" from "I debug Python." Circular imports and module caching come up in senior-level interviews and are daily pain points in large codebases.

**Python version notes:** The importlib-based import system has been the default since Python 3.3. Namespace packages (PEP 420/PEP 451) are 3.3+. The examples below target Python 3.12+.

**Prerequisites:** [Functions & Scoping](/python/module-03/01-functions-first-class.md) (namespaces, how Python executes bodies), [What Python Is](/python/module-01/01-what-python-is.md) (CPython interpreter basics, `.pyc` files).

## 🗣️ In Plain English

::: tip In Plain English
Importing a module is like ordering a book from a library.

When you say `import json`, the librarian first checks your desk. If you already have a copy of that book sitting there from an earlier request, the librarian hands you that same copy instantly. No trip to the shelves, no reading the book again. This "already on your desk" check is the **module cache** — and it is the single most important thing to understand about imports. Modules are fetched and read **once**. Every subsequent request gets the same copy.

If the book is not on your desk, the librarian needs to find it. They don't rummage through every shelf randomly — they have a specific search order. They check several specialized search teams, one after another. The first team handles built-in books that are part of the library itself (like `sys` or `os`). The second team searches a list of shelves in a fixed order: the shelf closest to you (the directory your script lives in), any shelves you specifically asked to add (environment variables), and finally the big public shelves where community books are stored (site-packages, where `pip install` puts things).

When a search team finds the book, a reader opens it and reads the entire thing aloud from cover to cover — once. That reading is the **execution** of the module's top-level code. Every function definition, class definition, and variable assignment in the file runs during that reading. The results are written onto a card (the module object), and the card goes on your desk.

Here is the part that trips people up: if two books reference each other — Book A says "see Book B, page 5" and Book B says "see Book A, page 10" — the librarian can get stuck in a loop. They start reading Book A, get to the reference, pause A (leaving it half-read), go fetch B, start reading B, hit the reference back to A, and find A already on the desk — but only half-written. So B gets a **partial card** for A, with some entries missing. That is a **circular import**, and it does not always crash — sometimes it just silently gives you an incomplete module, which is worse.
:::

## ⚙️ Under the Hood

### Step 1: Check `sys.modules` (The Cache)

Every `import` statement — whether `import json`, `from os import path`, or `from . import sibling` — begins with a cache lookup in `sys.modules`. This is a plain dictionary mapping fully-qualified module names (strings) to module objects.

```python
# run: python3 import_cache.py
import sys

# Before importing json, it's not in the cache
# (unless something else already imported it)
print("json" in sys.modules)  # likely False on a fresh script

import json

# Now it's cached
print("json" in sys.modules)  # True
print(sys.modules["json"])     # <module 'json' from '...'>

# A second import just returns the cached object — no re-execution
import json as json2
print(json is json2)  # True — same object
```

**Key implication:** module-level code runs exactly once per interpreter session. If a module has a `print("I'm loading!")` at the top level, you will see that message once, no matter how many files import it.

### Step 2: Find the Module (Finders)

If `sys.modules` does not contain the module, Python needs to find it. It iterates through **`sys.meta_path`** — an ordered list of **finder** objects. Each finder implements `find_spec(name, path, target)` and returns either a `ModuleSpec` or `None`.

```python
# run: python3 show_finders.py
import sys

for finder in sys.meta_path:
    print(type(finder).__name__)
# Typical output on CPython 3.12:
#   BuiltinImporter    — handles built-in C modules (sys, _thread, etc.)
#   FrozenImporter     — handles frozen modules (used during interpreter startup)
#   PathFinder         — the big one: searches sys.path for .py/.pyc files and packages
```

The **PathFinder** is where most action happens. It searches through `sys.path` entries in order, using **path entry finders** (hooks registered in `sys.path_hooks`) to check each directory or zip file.

### Step 3: `sys.path` — Where Python Looks

`sys.path` is a list of strings (directory paths, zip files, or empty string meaning CWD). PathFinder checks each entry in order.

```python
# run: python3 show_sys_path.py
import sys

print("sys.path entries:")
for i, p in enumerate(sys.path):
    print(f"  [{i}] {p!r}")
```

**How `sys.path` is constructed** (in order):

| Source | What it adds |
|--------|-------------|
| Script directory | The directory containing the script passed to `python3`. For `python3 /home/user/app/main.py`, this is `/home/user/app`. For `python3 -m pkg`, this is the current working directory. |
| `PYTHONPATH` env var | Colon-separated list of directories, prepended after the script dir |
| Site-packages | Standard library dirs + `site-packages` (where pip installs). Computed by the `site` module at startup. |
| `.pth` files | Files in site-packages whose lines are added to `sys.path`. Used by editable installs. |

### Step 4: Load the Module (Loaders)

Once a finder returns a `ModuleSpec`, the spec's **loader** handles the actual loading. The loader:

1. Creates a new module object
2. Sets it in `sys.modules` **before** executing the module code (this is critical for circular imports)
3. Executes the module's code in the module's namespace
4. If execution raises an exception, removes the module from `sys.modules`

```python
# run: python3 show_spec.py
import importlib
import importlib.util

spec = importlib.util.find_spec("json")
print(f"Name:   {spec.name}")
print(f"Origin: {spec.origin}")          # file path
print(f"Loader: {type(spec.loader).__name__}")  # SourceFileLoader
print(f"Package:{spec.parent}")          # '' for top-level, package name for submodules
```

### Step 5: Bind the Name

After loading, Python binds the module (or attributes from it) into the importing module's namespace:

| Statement | Binding |
|-----------|---------|
| `import json` | `json` = the module object |
| `import os.path` | `os` = the `os` module (but `os.path` is accessible through it) |
| `from json import dumps` | `dumps` = `json.dumps` (a reference to the attribute) |
| `from json import *` | All names in `json.__all__`, or all public names (no leading `_`) |

### `__init__.py` and Package Initialization

A **package** is a directory containing an `__init__.py` (or, for namespace packages, no `__init__.py` at all — more on that below).

When you `import mypackage`, Python:
1. Finds the `mypackage/` directory
2. Executes `mypackage/__init__.py` as the package's module code
3. The resulting module object represents the package

```python
# run: python3 -c "
# Demonstrate: create a package, import it, see __init__.py execute
import os, sys, tempfile, shutil

tmp = tempfile.mkdtemp()
pkg_dir = os.path.join(tmp, 'demopkg')
os.makedirs(pkg_dir)

# Write __init__.py
with open(os.path.join(pkg_dir, '__init__.py'), 'w') as f:
    f.write('print(\"__init__.py is running!\")\nVERSION = \"1.0\"\n')

# Write a submodule
with open(os.path.join(pkg_dir, 'utils.py'), 'w') as f:
    f.write('print(\"utils.py is running!\")\ndef helper(): return 42\n')

sys.path.insert(0, tmp)
import demopkg          # prints: __init__.py is running!
print(demopkg.VERSION)  # 1.0
import demopkg.utils    # prints: utils.py is running!
print(demopkg.utils.helper())  # 42

# Second import — no print, already cached
import demopkg.utils    # (silent — cached)

shutil.rmtree(tmp)
"
```

**Implicit namespace packages (PEP 420):** Since Python 3.3, a directory without `__init__.py` can still act as a package. This is useful for large projects split across multiple directories on `sys.path`. However, namespace packages do not execute any initialization code, and they behave differently with relative imports. In practice, **always include `__init__.py`** unless you specifically need namespace package behavior.

### Relative Imports

Relative imports use dots to navigate the package tree:

```python
# Inside mypackage/submod/helpers.py:
from . import sibling        # same directory: mypackage/submod/sibling.py
from .. import parent_mod    # parent package: mypackage/parent_mod.py
from ..other import thing    # sibling package: mypackage/other/thing
```

**How they resolve:** Python uses the importing module's `__package__` attribute (set during loading) to compute the absolute target. One dot means "same package," two dots means "parent package," and so on.

```python
# run: python3 relative_import_demo.py
# This script shows what __package__ looks like
import json
print(f"json.__package__ = {json.__package__!r}")        # 'json'
print(f"json.__name__    = {json.__name__!r}")            # 'json'

import json.decoder
print(f"json.decoder.__package__ = {json.decoder.__package__!r}")  # 'json'
# Relative imports in json/decoder.py resolve against __package__ = 'json'
```

**Critical rule:** Relative imports do not work in scripts run directly with `python3 script.py` (because `__package__` is `None`). Use `python3 -m package.module` instead.

### Circular Imports

Circular imports are the most common import-related bug. Here is the exact mechanism:

```python
# --- File: circle_a.py ---
# run: python3 circle_a.py
print("A: starting")
from circle_b import b_func   # Pauses A, starts loading B

def a_func():
    return "from A"

print("A: finished")

# --- File: circle_b.py ---
print("B: starting")
from circle_a import a_func   # A is in sys.modules but PARTIALLY initialized

def b_func():
    return "from B"

print("B: finished")
```

**What happens step by step:**

1. Python starts executing `circle_a.py`. It prints "A: starting."
2. Python hits `from circle_b import b_func`. It has not loaded `circle_b` yet, so it starts loading it.
3. Python begins executing `circle_b.py`. It prints "B: starting."
4. Python hits `from circle_a import a_func`. It checks `sys.modules` — `circle_a` **is** there (it was added before execution began in step 1). But `a_func` has not been defined yet because execution of `circle_a` paused at step 2. The module object exists but `a_func` is not an attribute on it yet.
5. **Result:** `ImportError: cannot import name 'a_func' from partially initialized module 'circle_a'`

**Fixes for circular imports:**

| Strategy | How |
|----------|-----|
| Import at function level | Move `from circle_a import a_func` inside `b_func()` — deferred until call time |
| Import the module, not the name | Use `import circle_a` and then `circle_a.a_func()` — attribute lookup happens at call time, after both modules are fully loaded |
| Restructure | Extract shared code into a third module imported by both |
| TYPE_CHECKING guard | For type hints only: `if TYPE_CHECKING: from circle_a import SomeType` |

```python
# run: python3 circle_fix.py
# Demonstration of the "import module, not name" fix

# --- Simulated circle_a ---
import sys
import types

mod_a = types.ModuleType("circle_a_fixed")
mod_b = types.ModuleType("circle_b_fixed")

# Register both in sys.modules before executing either
sys.modules["circle_a_fixed"] = mod_a
sys.modules["circle_b_fixed"] = mod_b

# "Execute" module A
exec("""
import circle_b_fixed  # import the module, not a name from it

def a_func():
    return "A calling B: " + circle_b_fixed.b_func()
""", mod_a.__dict__)

# "Execute" module B
exec("""
import circle_a_fixed  # import the module, not a name from it

def b_func():
    return "hello from B"
""", mod_b.__dict__)

# Both work because attribute lookup is deferred to call time
print(mod_a.a_func())  # A calling B: hello from B
```

### `importlib.reload()`

`importlib.reload(module)` re-executes a module's source code and updates the **existing** module object in place.

```python
# run: python3 reload_demo.py
import importlib
import sys
import types
import tempfile
import os

# Create a module file
tmp = tempfile.mkdtemp()
mod_path = os.path.join(tmp, "counter.py")

with open(mod_path, "w") as f:
    f.write("COUNT = 1\n")

sys.path.insert(0, tmp)
import counter
print(f"Before reload: COUNT = {counter.COUNT}")  # 1

# Modify the file
with open(mod_path, "w") as f:
    f.write("COUNT = 2\n")

# Reload
importlib.reload(counter)
print(f"After reload: COUNT = {counter.COUNT}")  # 2

# BUT: existing references are NOT updated
from counter import COUNT  # This grabbed the value 2
with open(mod_path, "w") as f:
    f.write("COUNT = 3\n")
importlib.reload(counter)
print(f"counter.COUNT = {counter.COUNT}")  # 3
print(f"local COUNT   = {COUNT}")          # still 2! Stale reference

# Cleanup
import shutil
shutil.rmtree(tmp)
```

**What reload does NOT do:**
- It does not update references that other modules already grabbed via `from module import name`
- It does not re-run `__init__.py` of parent packages
- It does not reload submodules — you must reload each one explicitly
- It does not remove names that were deleted from the source file (the old names linger on the module object)

### `__all__`: Controlling Star Imports

`__all__` is a list of strings that defines what `from module import *` exports:

```python
# run: python3 all_demo.py
import types
import sys

# Simulate a module with __all__
mod = types.ModuleType("mymod")
exec("""
__all__ = ["public_func", "PublicClass"]

def public_func():
    return "I'm public"

def _private_func():
    return "I'm private"

def unlisted_func():
    return "I'm public-looking but not in __all__"

class PublicClass:
    pass
""", mod.__dict__)

sys.modules["mymod"] = mod

# from mymod import * would only bring in public_func and PublicClass
print(f"__all__ = {mod.__all__}")
print(f"Has public_func:   {hasattr(mod, 'public_func')}")     # True
print(f"Has _private_func: {hasattr(mod, '_private_func')}")   # True — still accessible
print(f"Has unlisted_func: {hasattr(mod, 'unlisted_func')}")   # True — still accessible

# But star-import would only bind names in __all__
```

Without `__all__`, `from module import *` imports all names that do not start with an underscore. **Best practice:** always define `__all__` in public modules to make the API explicit.

### `__name__ == "__main__"`: Entry Point Detection

When Python runs a file directly (`python3 script.py`), it sets `__name__` to `"__main__"`. When the same file is imported as a module, `__name__` is set to the module's fully-qualified name.

```python
# run: python3 main_demo.py
# Also try: create another file that does "import main_demo"
print(f"__name__ = {__name__!r}")

def main():
    print("Running as the main script")

if __name__ == "__main__":
    main()
# Output when run directly: __name__ = '__main__', then "Running as the main script"
# Output when imported: __name__ = 'main_demo', main() is not called
```

**`python3 script.py` vs `python3 -m module`:**

| Aspect | `python3 script.py` | `python3 -m module` |
|--------|---------------------|---------------------|
| `__name__` | `"__main__"` | `"__main__"` |
| `__package__` | `None` | The parent package name |
| `sys.path[0]` | Directory of the script | Current working directory |
| Relative imports | Fail (no package context) | Work correctly |

The `-m` flag tells Python to search `sys.path` for the module, load it as part of its package, and then execute it. This is why `python3 -m pytest` works from any directory — Python finds the `pytest` package in site-packages and runs its `__main__.py`.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Circular imports that silently produce `None` attributes**

Symptom: `AttributeError: module 'config' has no attribute 'DATABASE_URL'` — but you can clearly see `DATABASE_URL` defined in `config.py`. Root cause: a circular import chain causes `config.py` to be only partially executed when another module accesses it. The attribute exists in the source but has not been executed yet at the point of import. Diagnosis: add `print(f"Loading {__name__}, attrs: {dir()}")` at the bottom of suspect modules to see what has been defined by the time the module finishes loading. Fix: restructure imports or defer them to function level.

**2. `sys.path` pollution causing wrong module to load**

Symptom: tests pass locally but fail in CI with `ModuleNotFoundError` or, worse, silently import a different module with the same name (a local `json.py` shadowing the standard library `json`). Root cause: running `python3 script.py` puts the script's directory at `sys.path[0]`. If that directory contains a file named `json.py`, it shadows the stdlib `json`. Diagnosis: `python3 -c "import json; print(json.__file__)"` — if it prints your local file instead of the stdlib path, you have a shadow. Fix: never name your files after stdlib modules.

**3. `importlib.reload()` in production causing state inconsistency**

Symptom: after reloading a module, some parts of the application see new behavior while others use stale references. Objects created before the reload are instances of the old class; `isinstance()` checks against the new class fail. Root cause: `reload()` replaces the module's attributes but existing references in other modules are not updated. Diagnosis: avoid reload in production entirely. Use process restart instead. If you must reload (e.g., plugin systems), re-import names in all consuming modules or use module-level attribute access (`module.func()` instead of importing `func` directly).

:::

## 🎯 Checkpoint

::: details Question 1 — Why does Python add a module to sys.modules before executing it?
**Q:** When Python loads a module, it inserts the (empty) module object into `sys.modules` *before* running the module's code. Why?

**A:** This is Python's mechanism for handling circular imports. If module A imports module B, and module B imports module A, the second import of A finds it already in `sys.modules` and returns the partially-initialized module object instead of entering an infinite loop. Without this pre-insertion, circular imports would cause infinite recursion. The trade-off is that the importing module may see an incomplete module — attributes that have not been defined yet are missing. This is why circular imports sometimes produce `ImportError` (when using `from module import name` and the name has not been executed yet) or `AttributeError` (when accessing the attribute later).
:::

::: details Question 2 — Relative imports and direct execution
**Q:** You have a package `mypkg/` with `__init__.py`, `core.py`, and `utils.py`. In `core.py` you write `from . import utils`. Running `python3 mypkg/core.py` fails with `ImportError: attempted relative import with no known parent package`. Why, and how do you fix it?

**A:** When you run `python3 mypkg/core.py`, Python sets `__name__` to `"__main__"` and `__package__` to `None`. Relative imports resolve using `__package__` to determine the current package — with `__package__` being `None`, Python cannot compute what `.` refers to. The fix is to run the module via the package: `python3 -m mypkg.core`. This sets `__package__` to `"mypkg"`, allowing the relative import to resolve `.` as the `mypkg` package. Alternatively, restructure to use absolute imports (`from mypkg import utils`), but then the package name is hardcoded.
:::

::: details Question 3 — The reload trap
**Q:** You call `importlib.reload(config)` after changing `config.py` on disk. The module object now has the new values. But another module that did `from config import SECRET_KEY` at import time still uses the old value. Explain why.

**A:** `from config import SECRET_KEY` creates a binding in the importing module's namespace that points directly to the **object** that `config.SECRET_KEY` referenced at import time (e.g., a specific string object). When `importlib.reload(config)` runs, it re-executes `config.py` and updates the attributes on the `config` module object. But the importing module's `SECRET_KEY` variable still references the old string object — it is a separate name binding that was not updated. This is because `from X import Y` copies the reference at import time; it does not create a live link. To get updated values after a reload, you must either use `config.SECRET_KEY` (attribute access on the module object, which always reads the current attribute) or re-execute the `from config import SECRET_KEY` statement.
:::

## Key Mental Models

- **Modules are executed once and cached.** `sys.modules` is the single source of truth. Every `import` after the first is a dictionary lookup, not a file read.

- **Import is a four-step process: cache check, find, load, bind.** The cache check (`sys.modules`) short-circuits most imports. Finding uses finders from `sys.meta_path`. Loading means executing the module's top-level code. Binding puts the result in the importing module's namespace.

- **Circular imports give you a half-baked module, not an error.** Because Python inserts modules into `sys.modules` before executing them, circular references get a partially-initialized object. The symptom is missing attributes, not always an exception.

- **`from X import Y` copies a reference; `import X` defers lookup.** If `X.Y` changes later (reload, monkey-patch), only `import X` + `X.Y` sees the change. `from X import Y` is a snapshot.

- **`python3 -m pkg.mod` is not the same as `python3 pkg/mod.py`.** The `-m` flag preserves package context (`__package__`), enables relative imports, and sets `sys.path[0]` to CWD instead of the script's directory.

## Related

- [Module 3 — Functions & Scoping](/python/module-03/) — namespaces and scoping rules that govern what `import` puts where.
- [Module 1 — What Python Is](/python/module-01/01-what-python-is.md) — CPython internals, `.pyc` bytecode compilation that happens during import.
- [Virtual Environments & Modern Packaging](./02-venvs-packaging.md) — the ecosystem that puts files where `sys.path` can find them.
