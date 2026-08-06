---
title: What Python Actually Is
outline: deep
---

# What Python Actually Is

> **Interview weight:** 🔥🔥 — rarely asked directly, but misunderstanding Python's execution model causes wrong answers about performance, the GIL, and optimization questions.
> **Python version notes:** Examples target Python 3.12+. Bytecode details are CPython-specific and change between minor versions.
> **Prerequisites:** None — this is the starting page.

## 🗣️ In Plain English

::: tip In Plain English
Imagine you write a recipe in French. Your kitchen staff only speaks machine language — raw binary instructions specific to your oven model. You could hire a translator to rewrite the entire recipe into machine language before anyone starts cooking (that is what C does). Or you could hire a bilingual sous-chef who reads each French line, translates it to machine language in their head, and immediately tells the cook what to do, one step at a time (that is a pure interpreter).

Python does something in between. There is a prep stage: before the kitchen opens, the sous-chef reads your entire French recipe and rewrites it into a **shorthand notation** — not machine language, but a compact, unambiguous set of instructions that is much faster for the sous-chef to read at cooking time. That shorthand is called **bytecode**, and the rewriting step is a real compilation step. The shorthand even gets saved to a card (a `.pyc` file) so next time the sous-chef does not have to redo the translation — they just pull the card from the drawer.

At service time, the sous-chef reads the shorthand card line by line and tells the cook exactly what to do. That sous-chef is the **Python Virtual Machine** (PVM). It is a loop — read one shorthand instruction, execute it, move to the next.

So Python is compiled, just not to the language your CPU speaks natively. It compiles to an intermediate shorthand, then a virtual machine executes that shorthand. This is why people call Python "interpreted" — the final execution step is indeed interpretation — but dismissing the compile step leads to real misunderstandings about how `.pyc` caching works, why syntax errors are caught before any code runs, and where the performance bottleneck actually lives.

The sous-chef (CPython, the default implementation) is written in C. Other implementations swap out the sous-chef entirely — PyPy's sous-chef watches which shorthand instructions run most often and, for those, goes ahead and translates them all the way to machine language on the fly. That is JIT compilation, and it is why PyPy can be several times faster for long-running programs.
:::

## ⚙️ Under the Hood

### CPython Architecture

CPython processes your source in a pipeline with four stages:

1. **Lexing + Parsing** — the source string is tokenized and parsed into a Concrete Syntax Tree (CST), then lowered to an **Abstract Syntax Tree** (AST). Since Python 3.9, CPython uses a PEG parser (replacing the older LL(1) parser).
2. **AST optimization** — constant folding, dead-branch elimination of `if 0:`, and a few other peephole transforms happen at the AST level (moved here from a bytecode peephole pass in 3.12+).
3. **Compilation to bytecode** — the AST is walked by `Python/compile.c` (or, since 3.13, the new `Python/flowgraph.c` pipeline) to produce a sequence of bytecode instructions stored in a **code object** (`types.CodeType`).
4. **Execution by the PVM** — `Python/ceval.c` implements the evaluation loop: a `switch` over opcodes operating on a value stack. Since 3.12, CPython ships with a specializing adaptive interpreter that rewrites "cold" generic opcodes into type-specialized variants after a few executions (PEP 659).

You can inspect every stage from Python itself:

```python
# run: python3 ast_demo.py
import ast

source = "x = 1 + 2"
tree = ast.parse(source)
print(ast.dump(tree, indent=2))
```

Output (abbreviated):

```
Module(
  body=[
    Assign(
      targets=[Name(id='x', ctx=Store())],
      value=Constant(value=3))       # <-- constant folding already happened
  ])
```

The `compile()` built-in drives stage 3:

```python
# run: python3 compile_demo.py
source = "x = 1 + 2"
code = compile(source, "<demo>", "exec")
print(type(code))            # <class 'code'>
print(code.co_consts)        # (3, None)  — only the folded constant
print(code.co_names)         # ('x',)
print(code.co_code.hex())    # raw bytecode bytes
```

### The Compilation Step

When you run `python3 app.py`, CPython compiles every imported module to bytecode and caches the result under `__pycache__/` as `.pyc` files. The main script is **not** cached — only imports are.

**Naming convention:** `module.cpython-312.pyc` — the tag encodes the implementation and version so multiple Python versions can coexist.

**Invalidation:** CPython checks the source file's **last-modified timestamp** and **file size** (since Python 3.7, PEP 552 also supports hash-based validation when enabled). If either differs from the values baked into the `.pyc` header, the module is recompiled.

The `.pyc` format:

| Offset (bytes) | Content |
|---|---|
| 0–3 | Magic number (changes every minor version — this is why `.pyc` files are not portable across versions) |
| 4–7 | Bit flags (0 = timestamp mode, 1/3 = hash mode) |
| 8–11 | Source timestamp (if timestamp mode) |
| 12–15 | Source size |
| 16+ | Marshalled code object |

The `marshal` module handles serialization of code objects, but it is a CPython internal format — **not** stable across versions and not meant for data interchange (use `pickle` or `json` for that).

You can force compilation explicitly:

```python
# run: python3 -m py_compile my_module.py
# Or compile an entire directory tree:
# run: python3 -m compileall src/
```

Useful flags:

- `python3 -B` — do not write `.pyc` files at all (env var: `PYTHONDONTWRITEBYTECODE=1`).
- `python3 -O` — set `__debug__` to `False`, strip `assert` statements (produces `.opt-1.pyc`).
- `python3 -OO` — also strip docstrings (produces `.opt-2.pyc`).

### Reading Bytecode with dis

The `dis` module is your X-ray into the PVM. Every function carries a code object accessible via `func.__code__`.

```python
# run: python3 dis_demo.py
import dis

def add(a: int, b: int) -> int:
    return a + b

dis.dis(add)
```

Output (Python 3.12+):

```
  3           0 RESUME                   0

  4           2 LOAD_FAST                0 (a)
              4 LOAD_FAST                1 (b)
              6 BINARY_OP                0 (+)
             10 RETURN_VALUE
```

Key opcodes to know:

| Opcode | Meaning |
|---|---|
| `LOAD_FAST` | Push a local variable onto the stack (by slot index) |
| `STORE_FAST` | Pop TOS into a local variable slot |
| `LOAD_CONST` | Push a constant from `co_consts` |
| `LOAD_GLOBAL` | Push a global/builtin (2-step lookup since 3.12: inline cache for globals) |
| `BINARY_OP` | Pop two values, apply operator, push result |
| `CALL` | Call a callable (replaced `CALL_FUNCTION` in 3.12) |
| `RETURN_VALUE` | Return TOS to the caller |
| `GET_ITER` | Call `iter()` on TOS |
| `FOR_ITER` | Advance the iterator; jump past the loop on `StopIteration` |

A `for` loop desugars into iterator protocol bytecode:

```python
# run: python3 dis_loop.py
import dis

def loop_sum(items: list[int]) -> int:
    total = 0
    for x in items:
        total += x
    return total

dis.dis(loop_sum)
```

The core loop in the output shows `GET_ITER` followed by `FOR_ITER` — the PVM calls `__next__()` on each iteration and jumps out of the loop when `StopIteration` is raised internally.

**Inspecting code objects directly:**

```python
# run: python3 code_object.py
def example(a: int, b: int) -> int:
    c = a * b
    return c + 1

co = example.__code__
print(f"co_varnames:  {co.co_varnames}")    # ('a', 'b', 'c')
print(f"co_consts:    {co.co_consts}")       # (None, 1)
print(f"co_stacksize: {co.co_stacksize}")    # max stack depth the PVM needs
print(f"co_nlocals:   {co.co_nlocals}")      # 3
print(f"bytecode len: {len(co.co_code)} bytes")
```

`co_stacksize` is computed at compile time — the compiler simulates stack effects of every opcode path to find the maximum. This is why an infinite recursion blows the **call** stack (frame allocation), not the value stack.

### Other Python Implementations

| Implementation | Backend | Key trait | Typical use case |
|---|---|---|---|
| **CPython** | C | The reference. Defines "what Python is." | Everything — it is the default |
| **PyPy** | RPython → C (meta-tracing JIT) | 4-10x faster for long-running CPU-bound code | Servers, data pipelines where startup cost is amortized |
| **Jython** | JVM bytecode | Access to Java libraries; no GIL | Java-ecosystem integration (limited to Python 2.7) |
| **IronPython** | .NET CLR | Access to .NET libraries | .NET scripting (Python 3 support via IronPython 3) |
| **MicroPython** | Custom VM, bare metal | Fits in 256 KB RAM | Microcontrollers (ESP32, Raspberry Pi Pico) |
| **GraalPy** | GraalVM (Truffle framework) | Polyglot — interop with JS, Java, Ruby in one VM | GraalVM-based polyglot applications |

The important insight: these implementations share the **language specification** but not the bytecode format, not the C API, and not the GIL semantics. PyPy has a GIL but its JIT makes many workloads fast enough that you do not need to escape to C extensions. Jython and IronPython have no GIL at all because their host VMs handle threading natively — but they cannot run C extensions, which locks them out of NumPy, pandas, and most of the data-science ecosystem.

### The REPL and Startup

**Entry points:**

- `python3 script.py` — run a file.
- `python3 -c "print('hello')"` — run a string.
- `python3 -m module_name` — run a module as a script (looks it up on `sys.path`, executes its `__main__.py` or the module itself). This is how you invoke `pip`, `venv`, `pytest`, `http.server`, etc.
- `python3` with no arguments — interactive REPL. Since Python 3.13, the REPL has color output, multi-line editing, and `help()` improvements.

**What happens at startup:**

1. The interpreter initializes internal state (memory allocator, type system, built-in modules like `sys` and `builtins`).
2. **`sys.path` is constructed:** the script's directory (or `''` for interactive), `PYTHONPATH` entries, site-packages directories.
3. **`site.py` executes** — it appends `site-packages` to `sys.path`, processes `.pth` files, and sets up `quit`/`exit` helpers. Disable with `python3 -S`.
4. **`PYTHONSTARTUP`** — if this env var points to a file, it is executed in interactive mode only (not for scripts). Useful for loading readline history or custom helpers.

**Useful flags for production:**

```bash
# Don't write .pyc (useful in read-only containers)
python3 -B app.py

# Strip asserts (they should not be control flow in production)
python3 -O app.py

# Strip asserts AND docstrings (marginal memory saving)
python3 -OO app.py

# Unbuffered stdout/stderr (important for Docker log visibility)
python3 -u app.py
# or: PYTHONUNBUFFERED=1

# Show warnings (default hides DeprecationWarning in non-__main__)
python3 -W all app.py

# Run with development mode (extra warnings, debug hooks, faulthandler)
python3 -X dev app.py
```

### The Zen of Python

```python
# run: python3 -c "import this"
```

The 19 aphorisms (by Tim Peters) are not just philosophy — they are enforced design decisions:

- **"Explicit is better than implicit"** — Python has no implicit type coercion between unrelated types (`"3" + 3` is a `TypeError`, not `"33"` or `6`). Contrast with JavaScript.
- **"There should be one — and preferably only one — obvious way to do it"** — this is why Python resisted adding a ternary operator for years, and when it added one (`x if cond else y`) it deliberately chose a readable-English order rather than C's `cond ? x : y`.
- **"Errors should never pass silently / Unless explicitly silenced"** — this explains why bare `except:` is discouraged, why `dict[missing_key]` raises `KeyError` instead of returning `None` (contrast Go), and why Python 3 chained exceptions with `__cause__` and `__context__`.
- **"Flat is better than nested"** — the cultural preference for early returns, comprehensions over deeply nested loops, and the resistance to callback-heavy patterns.
- **"Readability counts"** — meaningful indentation is the most famous example, but it also manifests in the standard library's naming (`os.path.join`, not `os.path.J`), the preference for words over symbols, and the `self` parameter being explicit.

The Zen is aspirational — Python violates its own aphorisms regularly (there are at least three ways to format strings). But knowing the aphorisms tells you which direction the language community will push when making design trade-offs.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**1. Stale `.pyc` files after deployment**
Symptom: you deploy new code, but the application behaves as if running the old version. Logs show logic that no longer exists in your source. Root cause: the deployment copied new `.py` files but preserved old `__pycache__/` directories. Because the `.pyc` timestamp matched the *old* `.py` file and the new `.py` file got a fresh timestamp, CPython correctly recompiles — **unless** the container's filesystem does not preserve timestamps (e.g., some Docker `COPY` behaviors flatten timestamps, or you copy only `.pyc` files without sources). Fix: always delete `__pycache__/` on deploy (`find . -type d -name __pycache__ -exec rm -rf {} +`), or set `PYTHONDONTWRITEBYTECODE=1` and accept the per-import compile cost, or use hash-based `.pyc` validation (`-X hash_seed` plus `check_source` in `py_compile`).

**2. Python startup time in serverless / Lambda cold starts**
Symptom: Lambda cold starts take 2-5 seconds for a Python function that finishes in 50 ms. Root cause: CPython initialization, `site.py` processing, and importing large dependency trees (boto3 alone imports hundreds of modules) are all synchronous CPU work on every cold start. Each import triggers compilation if no `.pyc` exists (Lambda's `/var/task` is read-only, but `/tmp` is not pre-populated). Mitigation: pre-compile with `python -m compileall` in your build step, minimize imports (lazy-import heavy libraries), use `python -S` if you do not need site-packages processing, and consider Lambda SnapStart (if available for your runtime) or provisioned concurrency.

**3. Python version mismatch between dev and production**
Symptom: code works locally on 3.12 but fails in production on 3.10 with `SyntaxError` on `match` statements (3.10+), missing `tomllib` (3.11+), or different `asyncio` behavior. The `.pyc` magic number mismatch means cached bytecode is simply ignored (or raises `ImportError`), but the real danger is subtle semantic differences: exception groups (3.11+), the new `int`/`str` conversion limit (3.11+), or changed `__slots__` behavior. Fix: pin the exact Python version in your `Dockerfile` (`python:3.12.4-slim`, never `python:3`), enforce it in CI, and use `pyproject.toml`'s `requires-python` field.
:::

## 🎯 Checkpoint

::: details Question 1 — Is Python interpreted or compiled?
**Q:** Is Python an interpreted language or a compiled language? Explain precisely.

**A:** Python is both. The CPython implementation **compiles** source code to an intermediate representation called bytecode (stored in `.pyc` files under `__pycache__/`). That bytecode is then **interpreted** by the Python Virtual Machine (PVM) — a C-level evaluation loop (`ceval.c`) that dispatches opcodes against a value stack. The compilation step is real: syntax errors are caught here, constant folding happens, and the result is a serializable `code` object. What Python does *not* do (in CPython) is compile to native machine code — that is the step that languages like C, Go, and Rust perform. PyPy adds a JIT that does compile hot bytecode paths to machine code at runtime, blurring the line further. The accurate statement is: "CPython compiles to bytecode, then interprets the bytecode."
:::

::: details Question 2 — Why does CPython use a magic number in .pyc files?
**Q:** What is the magic number in a `.pyc` file, and what problem does it solve?

**A:** The magic number is a 4-byte value at offset 0 of every `.pyc` file. It changes with every CPython minor version (and sometimes between alpha/beta releases) because the bytecode instruction set changes — opcodes are added, removed, or renumbered. The magic number acts as a version tag: when CPython tries to load a `.pyc`, it checks the magic number first. If it does not match the running interpreter's expected value, the `.pyc` is rejected and the source is recompiled. Without this, loading bytecode compiled for a different Python version would cause undefined behavior — the PVM would interpret opcode bytes according to the wrong instruction table, leading to crashes or silent wrong results. This is also why you cannot share `.pyc` files across Python versions and why `__pycache__` names include the version tag (e.g., `cpython-312`).
:::

::: details Question 3 — What does python -O actually do?
**Q:** What is the effect of running `python -O` and `python -OO`? Are they safe for production use?

**A:** `python -O` sets the built-in `__debug__` variable to `False` (it is `True` by default) and instructs the compiler to **strip all `assert` statements** from the bytecode. The resulting `.pyc` files are saved with an `.opt-1.pyc` suffix. `python -OO` does everything `-O` does and additionally strips **docstrings** (`__doc__` attributes become `None`), saved as `.opt-2.pyc`. Safety considerations: `-O` is safe **if and only if** your code does not use `assert` for control flow (e.g., `assert user.is_admin, "unauthorized"` would silently disappear, creating a security hole). The Python documentation explicitly warns that asserts are debugging aids, not runtime checks. `-OO` can break code that inspects docstrings at runtime — notably, `doctest` stops working, `argparse` subcommands that use docstrings for help text break, and some API frameworks (FastAPI/Pydantic) that use docstrings for schema descriptions will produce empty descriptions. In practice, most production deployments do **not** use `-O`/`-OO` because the performance gain is negligible and the risk of assert-as-control-flow bugs is real.
:::

## Key Mental Models

- **Python is compiled — to bytecode, not machine code.** The compilation step (source → AST → bytecode) is where syntax errors are caught, constants are folded, and the result is cached in `.pyc` files.
- **The PVM is a stack machine.** Every operation pushes to or pops from a value stack; understanding this makes `dis` output immediately readable and demystifies "how Python runs."
- **CPython is one implementation of the Python language.** The language spec is separate from any particular runtime — PyPy, GraalPy, and others execute the same language with radically different performance characteristics.
- **`.pyc` caching is an optimization, not a requirement.** Python works perfectly without it (`-B`), but understanding the cache invalidation rules (timestamp + size, or hash-based) prevents an entire class of deployment bugs.
- **Startup cost is real and proportional to your import graph.** Every `import` triggers compilation (if uncached) and module-level execution — this is why serverless cold starts and CLI tool responsiveness care deeply about import discipline.

## Related

- [Node.js: What Node Actually Is](/nodejs/module-01/01-what-node-is) — compare Python's single-threaded PVM + GIL to Node's V8 + libuv architecture; both are "interpreted" in the colloquial sense, both have a compilation step under the hood
- [Python: Data Model](/python/module-01/02-data-model) — how the objects that the PVM manipulates are structured in memory
