---
title: LEGB Scoping & Closures
outline: deep
---

# LEGB Scoping & Closures

> **Interview weight:** 🔥🔥🔥 — closure behavior, `UnboundLocalError`, and the loop-variable gotcha appear constantly in senior Python interviews.
> **Python version notes:** Examples target Python 3.12+. Bytecode opcodes shown are CPython-specific and may differ between minor versions.
> **Prerequisites:** [Functions as First-Class Objects](./01-functions-first-class.md).

## 🗣️ In Plain English

::: tip In Plain English
Imagine you are looking for a specific tool — say, a wrench. You follow a strict search order and stop the moment you find one.

**First, you check your own workbench** (the Local scope). If you are inside a function and you defined something called "wrench" right there, you grab it. Done.

**If it is not on your workbench, you check the room you are inside** (the Enclosing scope). Maybe you are in a small workshop inside a larger workshop. The outer workshop might have a wrench on its bench. If you find it there, you use that one.

**If the room does not have it either, you check the building's shared tool room** (the Global scope). This is the module level — tools available to everyone in the building.

**Finally, if the building does not have it, you check the manufacturer's catalog** (the Built-in scope). Python ships with built-in names like `print` and `len` — they are always available as a last resort.

You never search upward past the catalog. If the wrench is not in any of those four places, you get an error — the tool simply does not exist.

Now, here is where closures come in. Suppose you are a worker in the small inner workshop and you need to take a tool home (the inner function gets returned and used elsewhere). You cannot take the outer workshop's workbench with you. So instead, you put the specific tool into a **sealed transparent box** — you can see the tool and use it, and if someone in the outer workshop changes what is in the box, you see the new thing. That box is called a **cell**. The closure does not photocopy the tool at the moment you pack up — it takes the box itself. This means if the outer workshop swaps the tool inside the box later (or if a loop keeps replacing what is in the box), you see whatever is in the box at the time you finally look, not what was in it when you packed.

That "I see the latest thing in the box" behavior is why closures over loop variables surprise people. The box always contains whatever the loop left in it last.
:::

## ⚙️ Under the Hood

### The LEGB Rule

Python resolves bare names (not attribute access like `obj.attr`) by searching four scopes in order:

| Scope | What it is | Created when |
|-------|-----------|-------------|
| **L**ocal | Variables assigned inside the current function | Function is called |
| **E**nclosing | Locals of any enclosing function(s), from inner to outer | Enclosing function is called |
| **G**lobal | Names at module level | Module is imported/executed |
| **B**uilt-in | `builtins` module (`print`, `len`, `Exception`, etc.) | Interpreter starts |

```python
# run: python3 legb_demo.py
x = "global"

def outer() -> None:
    x = "enclosing"

    def inner() -> None:
        # x = "local"  # uncomment to shadow enclosing
        print(x)       # LEGB: no local x → finds enclosing x

    inner()

outer()   # prints: enclosing
print(x)  # prints: global — outer's x is a different name binding
```

### Compile-Time Name Resolution

Python decides where a name lives **at compile time**, not at runtime. The compiler scans the entire function body for assignments, `for` target variables, `import` statements, `def`/`class` names, and parameter names — all of these mark a name as **local**. This decision is baked into the bytecode.

```python
# run: python3 compile_time_resolution.py
import dis

def reads_global() -> None:
    print(x)           # x never assigned here → LOAD_GLOBAL

def reads_local() -> None:
    print(x)           # x IS assigned below → LOAD_FAST (local)
    x = 10             # this assignment makes x local in the ENTIRE function

print("=== reads_global ===")
dis.dis(reads_global)
# You'll see LOAD_GLOBAL for x

print("\n=== reads_local ===")
dis.dis(reads_local)
# You'll see LOAD_FAST for x — even for the print(x) line above the assignment
```

The `reads_local` function will raise `UnboundLocalError` at runtime: the compiler marked `x` as local (because of the assignment on the next line), but when `print(x)` executes, local `x` has not been assigned yet.

### `UnboundLocalError` Explained

This is one of the most confusing errors for intermediate Python developers:

```python
# run: python3 unbound_local.py
count = 0

def increment() -> None:
    count = count + 1    # UnboundLocalError: cannot access local variable 'count'
    print(count)

try:
    increment()
except UnboundLocalError as e:
    print(f"Error: {e}")
    # Error: cannot access local variable 'count' before assignment

# The fix — if you intend to modify the global:
def increment_fixed() -> None:
    global count
    count = count + 1
    print(count)

increment_fixed()  # prints: 1
```

**Mechanism:** The compiler sees `count = count + 1`. The assignment `count = ...` marks `count` as local for the entire function. The bytecode uses `LOAD_FAST` for `count` on the right-hand side. At runtime, local `count` has no value yet — `UnboundLocalError`.

### `global` and `nonlocal` Statements

These statements override the compiler's default scoping decision:

```python
# run: python3 global_nonlocal.py
g = 0

def outer() -> None:
    e = 0

    def inner() -> None:
        global g       # "g" refers to the module-level g, not a local
        nonlocal e     # "e" refers to the enclosing function's e, not a local
        g += 1
        e += 1
        print(f"inner: g={g}, e={e}")

    inner()
    print(f"outer: e={e}")   # e was modified by inner

outer()
print(f"module: g={g}")      # g was modified by inner

# Output:
# inner: g=1, e=1
# outer: e=1
# module: g=1
```

`nonlocal` only works for enclosing function scopes — you cannot use it to reach the global or built-in scope. `global` only reaches the module level.

### Closures and Cell Objects

When an inner function references a variable from an enclosing scope, Python creates a **closure**. The mechanism uses **cell objects** — small containers that hold a reference to the enclosed variable.

```python
# run: python3 closure_cells.py
def make_counter(start: int = 0):
    count = start

    def increment() -> int:
        nonlocal count
        count += 1
        return count

    return increment

counter = make_counter(10)
print(counter())  # 11
print(counter())  # 12

# Inspect the closure
print(counter.__closure__)              # (<cell at 0x...>,)
print(counter.__closure__[0].cell_contents)  # 12

# The code object knows which names are free variables (closed over)
print(counter.__code__.co_freevars)     # ('count',)
```

**How cells work internally:**

1. When the compiler detects that a variable in an enclosing function is referenced by an inner function, it marks that variable as a **cell variable** in the outer function (`co_cellvars`) and as a **free variable** in the inner function (`co_freevars`).
2. At runtime, the outer function creates a `cell` object for each cell variable. Instead of storing the value directly in the local fast-slot, the value is stored inside the cell.
3. The inner function's `__closure__` tuple holds references to these same cell objects. Both functions read and write through the same cell, so changes are visible to both.

```python
# run: python3 cell_inspection.py
def outer() -> None:
    x = 10
    y = 20

    def inner() -> int:
        return x + y    # closes over x and y

    print(f"outer co_cellvars: {outer.__code__.co_cellvars}")  # () — need to check after call
    print(f"inner co_freevars: {inner.__code__.co_freevars}")  # ('x', 'y')
    print(f"inner __closure__:  {inner.__closure__}")

    # Both cells point to the current values
    for var, cell in zip(inner.__code__.co_freevars, inner.__closure__):
        print(f"  {var} = {cell.cell_contents}")

outer()
```

### The Late-Binding Closure Gotcha

This is a classic interview question:

```python
# run: python3 late_binding_bug.py
funcs = [lambda: i for i in range(3)]

print(funcs[0]())  # 2  — not 0!
print(funcs[1]())  # 2  — not 1!
print(funcs[2]())  # 2  — all return 2!
```

**Why:** Each lambda closes over the *variable* `i`, not the *value* of `i` at the time the lambda was created. All three lambdas share the same cell, and by the time you call them, the loop has finished and `i` is `2`.

**Fix 1 — default argument (captures the value at definition time):**

```python
# run: python3 late_binding_fix1.py
funcs = [lambda i=i: i for i in range(3)]

print(funcs[0]())  # 0
print(funcs[1]())  # 1
print(funcs[2]())  # 2

# Why this works: default arguments are evaluated at def time
# and stored in __defaults__, so each lambda gets its own snapshot
```

**Fix 2 — factory function (each call creates a new scope with its own variable):**

```python
# run: python3 late_binding_fix2.py
def make_func(val: int):
    return lambda: val   # val is a different variable in each call's scope

funcs = [make_func(i) for i in range(3)]

print(funcs[0]())  # 0
print(funcs[1]())  # 1
print(funcs[2]())  # 2
```

### Bytecode View of Closures

Seeing the actual opcodes makes the mechanism concrete:

```python
# run: python3 closure_bytecode.py
import dis

def make_adder(n: int):
    def adder(x: int) -> int:
        return x + n
    return adder

print("=== make_adder bytecode ===")
dis.dis(make_adder)
# Look for:
#   MAKE_CELL      n          — creates cell for n
#   LOAD_CLOSURE   n          — pushes the cell onto the stack
#   MAKE_FUNCTION             — builds function with closure tuple

print("\n=== adder bytecode ===")
add_five = make_adder(5)
dis.dis(add_five)
# Look for:
#   LOAD_DEREF     n          — reads n through the cell object
```

### Class and Instance Scopes Are Not LEGB Scopes

A common misconception: class bodies do **not** create an enclosing scope for methods.

```python
# run: python3 class_scope_trap.py
class MyClass:
    x = 10

    def method(self) -> int:
        # return x      # NameError! Class scope is NOT in LEGB for methods
        return self.x    # Must use self or MyClass.x

    # But this works in the class body itself:
    y = x + 5           # x is visible here (class body is executing)

obj = MyClass()
print(obj.method())     # 10
print(MyClass.y)        # 15
```

The class body runs as a special namespace, but methods are just functions — their LEGB chain skips the class body entirely.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Late-Binding in Callback Registration**
Symptom: all registered callbacks produce the same result, typically the last value. Common in web frameworks when building route handlers in a loop: `for route in routes: app.add_route(route.path, lambda req: handle(route))`. Every handler closes over the same `route` variable. By the time a request arrives, `route` is the last element.
Diagnosis: print `func.__closure__[0].cell_contents` on each registered callback — if they are all identical, you have late binding. Fix with a factory function or default argument.

**2. `UnboundLocalError` in Exception Handlers**
Symptom: an `UnboundLocalError` crash inside a function that "obviously" has the variable defined — but only in certain code paths. Example: `result` is assigned inside a `try` block, but the code in the `except` branch references `result` before the `try` has assigned it. Since the compiler saw `result = ...` anywhere in the function, it treats `result` as local everywhere.
Diagnosis: check whether all code paths assign the variable before it is read. Initialize the variable before the `try` block.

**3. Accidental Global Mutation**
Symptom: a "pure" utility function silently modifies module-level state. Someone wrote `global config` inside a helper and mutated `config`. In a multi-worker server (gunicorn with `preload_app`), the mutated global is shared across requests in the same worker, leading to cross-request data leaks.
Diagnosis: search the codebase for `global` statements. Prefer passing state as arguments and returning new values. Use linters like `pylint` which warn about `global` usage.
:::

## 🎯 Checkpoint

::: details Question 1 — Predict the output
**Q:** What does this print, and why?

```python
x = "global"
def f():
    print(x)
    x = "local"
f()
```

**A:** It raises `UnboundLocalError`. The compiler sees `x = "local"` and marks `x` as a local variable for the entire function body. When `print(x)` executes, it uses `LOAD_FAST` to look up local `x`, which has not been assigned yet. The global `x` is never consulted because the scoping decision was made at compile time, not runtime. To fix this, either remove the assignment, use `global x`, or rename the local variable.
:::

::: details Question 2 — Closure cells
**Q:** Explain what `cell` objects are, why Python uses them instead of just copying values, and what consequence this has for closures over loop variables.

**A:** Cell objects are small heap-allocated containers that hold a single reference. Python uses them because closures need to capture *variables*, not *values* — if the enclosing function modifies the variable after the closure is created (or if the closure uses `nonlocal` to modify it), both sides must see the change. Copying the value at closure-creation time would break this. The consequence for loop variables: a closure created inside a loop captures the cell for the loop variable, not a snapshot of its value. All closures share the same cell. When the loop finishes, the cell contains the final iteration value, so all closures return that same final value. The fix is to snapshot the value via a default argument (which is evaluated at definition time, not through a cell) or to use a factory function that creates a new scope (and thus a new cell) per iteration.
:::

::: details Question 3 — nonlocal vs global
**Q:** Can `nonlocal` reach a module-level variable? Can `global` reach an enclosing function's variable? Explain.

**A:** No to both. `nonlocal` only binds to the nearest enclosing **function** scope — it cannot reach the module (global) scope. If there is no enclosing function scope with that name, you get a `SyntaxError` at compile time. `global` always binds to the **module** scope, skipping any enclosing function scopes entirely. There is no way to directly target a specific enclosing scope by "distance" — `nonlocal` finds the nearest one, and `global` jumps to the top. If you need to modify a module-level variable, use `global`. If you need to modify a variable in the immediately enclosing function, use `nonlocal`. You cannot use `global` to alias an enclosing function's local.
:::

## Key Mental Models

- **LEGB is a search order, not a storage hierarchy** — Python checks Local, Enclosing, Global, Built-in in that exact order and stops at the first match.
- **Scoping is decided at compile time, enforced at runtime** — the compiler scans for assignments to decide if a name is local; `UnboundLocalError` is the runtime consequence of reading before assigning a compile-time-local name.
- **Closures capture variables, not values** — the cell object is a shared mutable container; the enclosed value can change after the closure is created.
- **Late binding is a feature, not a bug** — it is what makes `nonlocal` mutations visible to the closure; the gotcha arises only when you expect snapshot semantics.
- **Class bodies are not enclosing scopes** — methods cannot see class-level names through LEGB; they must use `self.x` or `ClassName.x`.

## Related

- [Functions as First-Class Objects](./01-functions-first-class.md) — how `def` creates function objects and binds names.
- [Decorators](./03-decorators.md) — decorators rely on closures to wrap behavior around functions.
- [Functional Programming Tools](./04-functional-tools.md) — `lambda` expressions and their scoping interactions.
- [Module 1 — What Python Actually Is](/python/module-01/01-what-python-is.md) — CPython's compilation pipeline that produces the bytecode shown here.
