---
title: Execution Contexts, Scopes & Hoisting
outline: deep
---

# Execution Contexts, Scopes & Hoisting

<Badge type="danger" text="Interview: High" /> <Badge type="info" text="Prereqs: None" />

## 🗣️ In Plain English

::: tip In Plain English
Think of running JavaScript like staging a theater production.

Before the curtain rises, there is a **creation phase**. The stage manager reads through the entire script and assigns dressing rooms to every actor who will appear. This is the engine scanning your code and registering every variable and function declaration it finds. But not every actor is treated the same:

- **`var` actors** get a dressing room *and* a generic understudy costume pinned to the door right away. That costume is `undefined` -- they are technically present, but they have not become their real character yet. If someone calls their name before their scene, the understudy stumbles out in a blank costume.

- **`let` and `const` actors** also get a dressing room assigned, but the door is *locked* until their cue arrives in the script. If anyone tries to open that door early, an alarm sounds -- that alarm is the `ReferenceError` you see when you hit the Temporal Dead Zone (TDZ). The room exists, the actor's name is on the door, but you cannot interact with them yet.

Once every room has been assigned, the curtain rises and the **execution phase** begins. Lines run top-to-bottom. Each actor steps on stage at the moment their scene begins. `var` actors swap out their understudy costume for the real one when the assignment line is reached. `let`/`const` actors unlock their door and step out fully costumed at the exact line of their declaration.

Now imagine the play has scenes within scenes -- a play-within-a-play. Each nested scene is a new **scope**, with its own set of dressing rooms. When an actor on an inner stage needs a prop they do not have, a stagehand walks outward through each enclosing scene's prop table until they find it. That walk is the **scope chain**.

Finally, some directors use `eval` or `with` -- think of them as shouting new stage directions mid-performance. The stage crew can no longer pre-arrange anything because the script might change at any moment, so they disable all their optimizations and everything runs slower.
:::

## ⚙️ Under the Hood

### What Is an Execution Context?

Every time the engine enters executable code it creates an **execution context** (EC). There are three types:

| Type | Created when |
|------|-------------|
| **Global EC** | Script first loads |
| **Function EC** | A function is invoked |
| **Eval EC** | `eval()` is called |

Each EC goes through two phases:

1. **Creation phase** -- set up the environment, register declarations.
2. **Execution phase** -- run code line by line.

### Variable Environment vs Lexical Environment

Inside every EC the spec defines two components:

| Component | Holds | Notes |
|-----------|-------|-------|
| **VariableEnvironment** | `var` declarations, `function` declarations | Scoped to the nearest *function* (or global) |
| **LexicalEnvironment** | `let`, `const`, `class` declarations | Scoped to the nearest *block* `{}` |

Both are **Environment Records** with an `[[OuterEnv]]` link pointing to the enclosing scope's environment. The chain of `[[OuterEnv]]` links forms the **scope chain**.

### How Hoisting Actually Works

"Hoisting" is not the engine physically moving declarations to the top of a file. During the **creation phase**, the engine walks all declarations and registers them in the appropriate environment record.

```ts
// run: node --experimental-strip-types demo.ts

// --- var hoisting ---
console.log(a); // undefined  (registered + initialized to undefined)
var a = 10;
console.log(a); // 10

// --- function declaration hoisting ---
console.log(greet("world")); // "hello world"  (fully hoisted)
function greet(name: string): string {
  return `hello ${name}`;
}

// --- function expression with var ---
console.log(typeof sayHi); // "undefined" (var hoisted, but value not yet assigned)
// sayHi();                // TypeError: sayHi is not a function
var sayHi = function (name: string): string {
  return `hi ${name}`;
};
```

**Key mechanic:** `var` bindings are created *and initialized to `undefined`* during the creation phase. Function declarations are created *and initialized to the function object* during the creation phase. That is why function declarations are usable before their textual position.

### Temporal Dead Zone (TDZ)

`let` and `const` bindings are created during the creation phase but are **not initialized**. The spec calls this state "uninitialized." Any access before the declaration line throws a `ReferenceError`. The region between the start of the scope and the declaration is the TDZ.

```ts
// run: node --experimental-strip-types demo.ts

{
  // TDZ for `x` starts here
  // console.log(x); // ReferenceError: Cannot access 'x' before initialization

  const x: number = 42; // TDZ ends, `x` is initialized
  console.log(x); // 42
}
```

Even `typeof` is not safe inside the TDZ:

```ts
// run: node --experimental-strip-types demo.ts

{
  // typeof undeclaredVar; // "undefined" -- typeof is safe for undeclared
  // typeof y;             // ReferenceError -- NOT safe inside TDZ
  let y: number = 1;
}
console.log("TDZ typeof demo passed");
```

### Scope Chain Resolution

When the engine resolves an identifier, it walks the chain:

1. Check the current environment record.
2. If not found, follow `[[OuterEnv]]` to the parent.
3. Repeat until the global environment (whose `[[OuterEnv]]` is `null`).
4. If still not found: `ReferenceError` in strict mode, implicit global creation in sloppy mode.

```ts
// run: node --experimental-strip-types demo.ts

const globalVal: string = "global";

function outer(): void {
  const outerVal: string = "outer";

  function inner(): void {
    const innerVal: string = "inner";
    // Resolves innerVal in inner's env, outerVal via [[OuterEnv]], globalVal two hops up
    console.log(innerVal, outerVal, globalVal); // "inner outer global"
  }

  inner();
}

outer();
```

### Block Scoping vs Function Scoping

```ts
// run: node --experimental-strip-types demo.ts

function demo(): void {
  // `var` is function-scoped -- visible throughout the function
  if (true) {
    var funcScoped: number = 1;
    let blockScoped: number = 2;
  }

  console.log(funcScoped);  // 1
  // console.log(blockScoped); // ReferenceError: blockScoped is not defined
}

demo();

// Classic loop trap
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log("var i:", i), 0); // 3, 3, 3
}

for (let j = 0; j < 3; j++) {
  setTimeout(() => console.log("let j:", j), 0); // 0, 1, 2
}
```

With `let`, the spec mandates a **new binding per loop iteration**. Each iteration's closure captures its own `j`. With `var`, there is a single `i` shared across all iterations.

### `eval` and `with` -- Why They Break V8 Optimizations

```ts
// run: node --experimental-strip-types demo.ts

// V8 can normally determine at parse time which variables a scope accesses.
// `eval` makes this impossible because it can introduce new bindings at runtime.

function optimized(): number {
  const x: number = 10;
  return x + 1; // V8 knows exactly what `x` is at compile time
}

function deoptimized(input: string): void {
  const x: number = 10;
  eval(input); // Could do anything: `var x = 99`, introduce new vars, etc.
  // V8 cannot optimize variable access in this scope
}

console.log(optimized()); // 11
// `with` is banned in strict mode entirely. In sloppy mode it dynamically
// extends the scope chain, making static analysis impossible.
```

When V8 encounters `eval` (direct call) or `with`, it marks the scope as **"dynamic"** and disables several optimizations:
- No allocation of variables to CPU registers.
- No dead-code elimination for unused outer variables (the closure must keep everything alive).
- Context objects are allocated on the heap instead of the stack.

### Ordering Puzzles

```ts
// run: node --experimental-strip-types demo.ts

// Puzzle 1: function declaration vs var
var double = function (n: number): number { return n * 2; };
function double(n: number): number { return n * 3; }

// During creation phase: function `double` is hoisted (value = n*3 function),
// then `var double` is registered but does NOT overwrite (var re-declaration
// of an already-initialized binding is a no-op during creation).
// During execution: the assignment `double = function(n) { return n * 2 }` runs.
console.log(double(5)); // 10  (the assignment wins at runtime)

// Puzzle 2: two function declarations -- last one wins during creation phase
function puzzle(): string { return "first"; }
function puzzle(): string { return "second"; }
console.log(puzzle()); // "second"
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**1. Accidental globals in sloppy mode.**
Forgetting `var`/`let`/`const` in sloppy mode creates a property on `globalThis`. In a Node.js worker thread or serverless function, that global leaks across invocations within the same process, causing data corruption between requests.

**2. TDZ in circular module dependencies.**
If module A imports from module B which imports from module A, the imported bindings exist but may still be in TDZ when first accessed. The result is a `ReferenceError` at runtime that only appears under specific import orderings -- extremely hard to reproduce locally.

**3. `var` in `switch` blocks.**
A `switch` statement is a single block. A `var` declared inside one `case` is visible in all other cases (and is `undefined` until assigned). A `let` declared without braces around the `case` body collides with `let` in another case in the same block, causing a `SyntaxError`.

**4. `eval` defeating tree-shaking and minification.**
Direct `eval()` forces bundlers to preserve all in-scope variable names because `eval` could reference them by name. This bloats production bundles and disables mangling in that scope.
:::

## 🎯 Checkpoint

::: details Question 1 -- Creation Phase Prediction
**Q:** What does the following code log and why?

```ts
console.log(typeof foo);
console.log(typeof bar);
var foo = "hello";
let bar = "world";
```

**A:** It logs `"string"` for `typeof foo`... wait, no. `var foo` is hoisted and initialized to `undefined`, so `typeof foo` is `"undefined"` (the string). The second line throws a `ReferenceError` because `bar` is in the TDZ -- `typeof` does *not* protect you from TDZ errors. The key distinction: `typeof` is safe for *undeclared* identifiers (returns `"undefined"`) but *not* for declared-but-uninitialized `let`/`const` bindings.
:::

::: details Question 2 -- Scope Chain Walk
**Q:** In a three-level nested function (global -> outer -> inner), `inner` references a variable declared in `outer`. How many environment record hops does the engine make, and what structure does it follow?

**A:** One hop. The engine checks `inner`'s own environment record first (miss), then follows the `[[OuterEnv]]` link to `outer`'s environment record (hit). The structure is a singly-linked list of environment records, each pointing to its parent via `[[OuterEnv]]`. The chain terminates at the global environment whose `[[OuterEnv]]` is `null`.
:::

::: details Question 3 -- var in a Loop
**Q:** Why does `var i` in a `for` loop combined with `setTimeout` print the final value of `i` for every callback?

**A:** `var` is function-scoped, so there is a single `i` binding shared across all iterations. Each `setTimeout` callback closes over the same `i`. By the time the callbacks execute (after the loop finishes), `i` has already reached its final value. `let` fixes this because the spec requires a fresh binding per iteration -- each callback closes over a different `j`.
:::

## Key Mental Models

- **Hoisting is registration, not relocation.** The engine does not move code; it registers identifiers during the creation phase and initializes them according to their declaration type.
- **TDZ is an initialization guard.** `let`/`const` bindings exist from scope entry but are locked until the declaration runs -- accessing them early is a hard error, not `undefined`.
- **Scope chain = linked list of environment records.** Identifier resolution walks `[[OuterEnv]]` pointers from inner to outer until found or `null`.
- **`var` is function-scoped; `let`/`const` are block-scoped.** This single rule explains the loop trap, the `switch` pitfall, and most hoisting surprises.
- **Dynamic scope injection (`eval`/`with`) is an optimization killer.** It forces the engine to abandon static analysis for the entire containing scope.

## Related

- [Closures](./02-closures)
- [Prototypes & `this`](./03-prototypes-this-classes)
- [ES Modules](./08-es-modules)
