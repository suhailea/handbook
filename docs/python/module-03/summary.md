---
title: Module 3 Summary
outline: deep
---

# Module 3 Summary — Functions & Scoping

## Mental Models Gained

1. **`def` is an executable assignment** — it creates a function object at runtime and binds a name in the current namespace, just like `x = 42`.
2. **Functions are objects with inspectable attributes** — `__defaults__`, `__closure__`, `__code__`, `__annotations__`, `__call__` are all first-class attributes, not hidden magic.
3. **Defaults are evaluated once at definition time** — mutable defaults are shared across calls because they live in `func.__defaults__`, not recreated per call.
4. **LEGB is a compile-time decision, runtime enforcement** — the compiler scans for assignments to decide scope; `UnboundLocalError` is the runtime consequence of reading before assigning a compile-time-local.
5. **Closures capture variables, not values** — cell objects are shared mutable containers; late binding means you see whatever value the variable holds when you finally look, not when the closure was created.
6. **Decorators are function reassignment** — `@dec def f` is exactly `f = dec(f)`. The `@` syntax is convenience, not new semantics.
7. **Comprehensions beat `map`/`filter` for readability** — but `partial`, `operator`, and `lru_cache` earn their place when they make intent clearer.
8. **`functools.wraps` preserves identity** — without it, decorated functions lose their `__name__`, `__doc__`, and traceability in monitoring tools.

## Self-Assessment Checklist

Test yourself — you should be able to answer each without looking anything up:

- [ ] Explain why `def f(x=[])` shares the same list across calls. Where is the list stored?
- [ ] Name the four scopes in LEGB order and give an example of each.
- [ ] Predict the output of a function that reads a variable before assigning it (the `UnboundLocalError` pattern).
- [ ] Explain the difference between `global` and `nonlocal`. Can `nonlocal` reach module scope?
- [ ] Describe what a cell object is and why closures use cells instead of value copies.
- [ ] Fix the late-binding closure gotcha (`[lambda: i for i in range(3)]`) and explain both fix strategies.
- [ ] Write a decorator with arguments (the triple-nested pattern) and explain each level's role.
- [ ] Explain decorator stacking order: which is applied first vs which executes first?
- [ ] Describe when `functools.partial` is preferable to a `lambda`.
- [ ] Explain why `@lru_cache` on an instance method causes memory leaks.

## Quick Reference

### Scoping Rules

| Scope | Keyword to modify | Lookup opcode | Created when |
|-------|-------------------|---------------|-------------|
| **L**ocal | (default for assignments) | `LOAD_FAST` | Function is called |
| **E**nclosing | `nonlocal` | `LOAD_DEREF` (through cell) | Enclosing function is called |
| **G**lobal | `global` | `LOAD_GLOBAL` | Module is imported |
| **B**uilt-in | (not modifiable) | `LOAD_GLOBAL` (fallback) | Interpreter starts |

### Parameter Kinds (in order)

| Kind | Syntax | Example |
|------|--------|---------|
| Positional-only | Before `/` | `def f(a, /)` |
| Positional-or-keyword | Normal | `def f(a)` |
| Var-positional | `*args` | `def f(*args)` |
| Keyword-only | After `*` or `*args` | `def f(*, k)` |
| Var-keyword | `**kwargs` | `def f(**kwargs)` |

Full signature: `def f(pos_only, /, normal, *args, kw_only, **kwargs)`

### Decorator Patterns

| Pattern | Structure | Use case |
|---------|-----------|----------|
| Simple decorator | `def dec(func) -> wrapper` | Add behavior (logging, timing) |
| Decorator with args | `def dec(arg) -> decorator -> wrapper` | Configurable behavior (retry count) |
| Decorator class | `class Dec(__init__, __call__)` | Stateful decorators (call counting) |
| Class decorator | `def dec(cls) -> cls` | Add/modify class attributes (`@dataclass`) |
| Stacked decorators | `@A @B @C def f` = `A(B(C(f)))` | Compose behaviors |

### Functional Tools Cheat Sheet

| Tool | Returns | When to use |
|------|---------|-------------|
| `lambda` | Function | Tiny throwaway callbacks |
| `map(f, iter)` | Lazy iterator | Transform with named function |
| `filter(f, iter)` | Lazy iterator | Select with predicate |
| `functools.reduce(f, iter)` | Single value | Well-known folds (sum, product) |
| `functools.partial(f, *a, **kw)` | Callable | Fix arguments |
| `functools.lru_cache(maxsize)` | Decorator | Memoize pure functions |
| `functools.cache` | Decorator | Unbounded memoization (3.9+) |
| `operator.itemgetter(k)` | Callable | `lambda x: x[k]` replacement |
| `operator.attrgetter(a)` | Callable | `lambda x: x.a` replacement |
| `operator.methodcaller(m)` | Callable | `lambda x: x.m()` replacement |

## What's Next

[Module 4 — OOP & Descriptors](/python/module-04/) builds on everything here. Descriptors use `__get__`/`__set__`/`__delete__` — the same protocol that makes decorated methods work. The MRO (Method Resolution Order) is Python's answer to "how do you look up names across an inheritance chain," extending the LEGB concept to attribute lookup on objects.
