---
title: "node:test, Mocking & Coverage"
outline: deep
---

# node:test, Mocking & Coverage

**Interview weight:** :fire::fire: | **Node.js 22+** (stable `node:test` since Node 20) | **Prerequisites:** [ESM](/nodejs/module-01/04-esm-interop)

## :speaking_head: In Plain English

::: tip In Plain English
Imagine you are a restaurant inspector. You need to test whether the kitchen produces good dishes. You could eat at the restaurant as a normal customer (an integration test), or you could walk into the kitchen, hand the chef specific ingredients, and watch exactly what they do with them (a unit test).

The **test runner** is your inspection framework -- it gives you a clipboard, a checklist, and a way to record pass/fail for each item. For years, Node.js did not come with one, so everyone brought their own clipboard (Jest, Mocha, Vitest). Starting with Node 18, Node ships its own: `node:test`.

**Mocking** is like replacing a real ingredient with a fake one to test how the chef reacts. If the recipe calls for fresh fish, you hand the chef a rubber fish to see if they notice (testing their validation) or to avoid the cost of real fish during every test run. `node:test` has a built-in `mock` object that can replace functions, methods, and even entire modules.

**Coverage** answers the question: "how much of the kitchen did the inspector actually visit?" If you only tested the salad station and never checked the grill, your coverage is incomplete. Node's built-in coverage tool tracks which lines of your code actually ran during tests and reports the percentage.

The beauty of `node:test` is that there is nothing to install. No `devDependencies`, no configuration files, no compatibility issues with your Node version. It is always there, always in sync with the runtime, and it understands ESM natively.
:::

## :gear: Under the Hood

### Basic Test Structure

```typescript
// run: node --experimental-strip-types --test basic.test.ts

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Top-level test
it('should add two numbers', () => {
  assert.strictEqual(1 + 1, 2);
});

// Grouped tests with describe
describe('Array', () => {
  let arr: number[];

  beforeEach(() => {
    arr = [1, 2, 3];
  });

  it('should return the length', () => {
    assert.strictEqual(arr.length, 3);
  });

  it('should include pushed items', () => {
    arr.push(4);
    assert.ok(arr.includes(4));
  });

  // Async test
  it('should work with async operations', async () => {
    const result = await Promise.resolve(42);
    assert.strictEqual(result, 42);
  });
});
```

### Test Function Variants

```typescript
// run: node --experimental-strip-types --test variants.test.ts

import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';

// test() and it() are functionally identical
test('using test()', () => {
  assert.ok(true);
});

// Skip a test
test('not ready yet', { skip: 'waiting for API' }, () => {
  // This body never runs
});

// TODO test
test('future feature', { todo: 'implement after v2' }, () => {
  // Runs but reported as TODO regardless of pass/fail
});

// Only run this test (like .only in Jest)
// Requires --test-only flag: node --test --test-only
test('focused test', { only: true }, () => {
  assert.ok(true);
});

// Timeout
test('must complete fast', { timeout: 1000 }, async () => {
  await new Promise(resolve => setTimeout(resolve, 500));
});

// Concurrency control within a describe block
describe('database tests', { concurrency: 1 }, () => {
  it('test 1', () => assert.ok(true));
  it('test 2', () => assert.ok(true));
});
```

### Assertions with `node:assert/strict`

```typescript
// run: node --experimental-strip-types --test assertions.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('assertion showcase', () => {
  // Equality
  assert.strictEqual(1, 1);
  assert.notStrictEqual(1, 2);

  // Deep equality (objects and arrays)
  assert.deepStrictEqual({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] });

  // Truthiness
  assert.ok(true);
  assert.ok(1);

  // Throws
  assert.throws(
    () => { throw new TypeError('boom'); },
    { name: 'TypeError', message: 'boom' }
  );

  // Async throws
  assert.rejects(
    async () => { throw new Error('async boom'); },
    { message: 'async boom' }
  );

  // Matching (partial object match)
  assert.match('hello world', /world/);
  assert.doesNotMatch('hello world', /xyz/);
});

// IMPORTANT: always use node:assert/strict (not node:assert)
// The non-strict version uses == instead of === for assert.equal(),
// which leads to surprising passes like assert.equal(1, '1')
```

### Mocking with `mock`

#### Mocking Functions and Methods

```typescript
// run: node --experimental-strip-types --test mock-methods.test.ts

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock a standalone function
test('mock a function', () => {
  const fn = mock.fn((x: number) => x * 2);

  assert.strictEqual(fn(3), 6);
  assert.strictEqual(fn.mock.callCount(), 1);
  assert.deepStrictEqual(fn.mock.calls[0].arguments, [3]);
  assert.strictEqual(fn.mock.calls[0].result, 6);
});

// Mock a method on an object
test('mock a method', () => {
  const calculator = {
    add(a: number, b: number): number { return a + b; },
    multiply(a: number, b: number): number { return a * b; },
  };

  // Replace calculator.add with a mock
  mock.method(calculator, 'add', (a: number, b: number) => a - b);

  // Now calculator.add actually subtracts
  assert.strictEqual(calculator.add(5, 3), 2);
  assert.strictEqual((calculator.add as any).mock.callCount(), 1);

  // Restore the original
  (calculator.add as any).mock.restore();
  assert.strictEqual(calculator.add(5, 3), 8);
});

// Mock timers
test('mock timers', () => {
  mock.timers.enable({ apis: ['setTimeout'] });

  let called = false;
  setTimeout(() => { called = true; }, 5000);

  // Advance time by 5 seconds
  mock.timers.tick(5000);
  assert.strictEqual(called, true);

  mock.timers.reset();
});
```

#### Mocking Modules (Node 22+)

Module mocking is a critical capability for testing code that imports dependencies:

```typescript
// run: node --experimental-strip-types --test mock-module.test.ts

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// IMPORTANT: mock.module() must be called BEFORE importing the module under test
// This is because ESM imports are live bindings -- once imported, the binding is set

test('mock a module', async () => {
  // Mock the node:fs/promises module
  mock.module('node:fs/promises', {
    namedExports: {
      readFile: mock.fn(async () => Buffer.from('mocked content')),
      writeFile: mock.fn(async () => undefined),
    },
  });

  // Now dynamically import the module under test
  // It will receive the mocked fs/promises
  const fs = await import('node:fs/promises');
  const content = await fs.readFile('/any/path', 'utf-8');

  assert.strictEqual(content.toString(), 'mocked content');

  // Clean up
  mock.restoreAll();
});
```

### ESM Mocking Challenges

ESM mocking is fundamentally harder than CJS mocking because of how the module systems differ:

| Aspect | CommonJS | ESM |
|---|---|---|
| Binding type | `require()` returns a mutable object | `import` creates live read-only bindings |
| Module cache | `require.cache` -- directly manipulable | Loader cache -- not directly accessible |
| Load timing | Synchronous, on demand | Asynchronous, can be static (hoisted) |
| Re-evaluation | Delete from cache and re-require | Cannot re-evaluate without loader hooks |

**Why `mock.module()` works:** Node's test runner integrates with the module loader at the V8 level. When you call `mock.module('node:fs/promises', ...)`, it registers a loader hook that intercepts the module resolution. Subsequent `import()` calls for that specifier receive the mock instead of the real module.

**The import order trap:**

```typescript
// THIS DOES NOT WORK:
import { readFile } from 'node:fs/promises'; // Already imported!
mock.module('node:fs/promises', { ... });     // Too late -- readFile is already bound

// THIS WORKS:
mock.module('node:fs/promises', { ... });           // Set up mock first
const { readFile } = await import('node:fs/promises'); // Dynamic import gets the mock
```

### Test Isolation and Parallel Execution

```typescript
// run: node --experimental-strip-types --test --test-concurrency=4 parallel.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// By default, top-level tests run concurrently
// Tests within a describe block run sequentially by default

describe('parallel suite', { concurrency: 4 }, () => {
  // These 4 tests run in parallel within this suite
  for (let i = 0; i < 4; i++) {
    it(`test ${i}`, async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok(true);
    });
  }
});

describe('sequential suite', { concurrency: 1 }, () => {
  // These run one at a time
  it('first', () => assert.ok(true));
  it('second', () => assert.ok(true));
});
```

**Isolation mechanisms:**
- Each test file runs in its own process (`--test` mode uses `child_process.fork`)
- Within a file, `describe` blocks can control concurrency
- `mock.restoreAll()` in `afterEach` prevents mock leakage between tests
- There is no shared state between test files -- no global setup/teardown across files (use `--test-setup` script if needed in Node 22+)

### Built-in Coverage

```typescript
// run: node --experimental-strip-types --test --experimental-test-coverage coverage-demo.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

function greet(name: string, formal: boolean): string {
  if (formal) {
    return `Good day, ${name}.`;
  }
  return `Hey ${name}!`;
}

test('informal greeting', () => {
  assert.strictEqual(greet('Alice', false), 'Hey Alice!');
});

// The formal branch is not tested -- coverage will show this
```

Running with `--experimental-test-coverage` produces output like:

```
# Coverage report
# ----------------
# file            | line % | branch % | funcs % | uncovered lines
# coverage-demo.test.ts | 87.50 | 50.00   | 100.00 | 10
```

**How it works internally:** Node uses V8's built-in code coverage support (the same mechanism Chrome DevTools uses). V8 instruments the bytecode to track which functions and branches execute. After tests complete, Node reads the coverage data from V8 and formats the report. No third-party instrumentation or source transforms needed.

#### Coverage Thresholds

*(Node 22+)*

```bash
# Fail if coverage is below thresholds
node --test --experimental-test-coverage \
  --test-coverage-lines=80 \
  --test-coverage-branches=80 \
  --test-coverage-functions=90 \
  tests/
```

#### Coverage Reporters

```bash
# Default: text summary to stdout
node --test --experimental-test-coverage tests/

# lcov format for integration with tools (e.g., Codecov, SonarQube)
node --test --experimental-test-coverage --test-reporter=lcov tests/
```

### Running Tests in Practice

```bash
# Run all test files matching the default pattern (*.test.ts, *.test.js, etc.)
node --experimental-strip-types --test

# Run specific files
node --experimental-strip-types --test tests/auth.test.ts tests/db.test.ts

# Run tests matching a name pattern
node --experimental-strip-types --test --test-name-pattern="should handle"

# Watch mode (re-run on file changes)
node --experimental-strip-types --test --watch

# Use TAP reporter for CI
node --experimental-strip-types --test --test-reporter=tap

# Use spec reporter for humans
node --experimental-strip-types --test --test-reporter=spec

# Combine: spec to stdout, TAP to file
node --experimental-strip-types --test \
  --test-reporter=spec --test-reporter-destination=stdout \
  --test-reporter=tap --test-reporter-destination=results.tap
```

## :boom: Where It Bites (Production Lens)

::: warning Where It Bites
**1. Import order breaks module mocks.** A developer writes `import { readFile } from 'node:fs/promises'` at the top of their test file and then calls `mock.module('node:fs/promises', ...)` inside a test. The mock has no effect because the static import already resolved and bound `readFile` to the real implementation. The test passes with real filesystem access, giving false confidence. Fix: always use `mock.module()` before a dynamic `import()` of the module under test.

**2. Mock leakage across tests.** A test mocks `Date.now` using `mock.timers.enable()` but does not call `mock.timers.reset()` in `afterEach`. Subsequent tests in the same file see frozen time, leading to timeout failures or incorrect timestamp assertions. The failures are order-dependent and disappear when tests run individually. Fix: always restore mocks in `afterEach`, or use `t.mock` (the per-test mock context) which auto-restores.

**3. Concurrency-related test flakiness.** Tests that use shared resources (a database, a file, a port) run concurrently by default at the file level. Two test files both try to bind to port 3000, and one fails with `EADDRINUSE`. The failure is intermittent because it depends on timing. Fix: use `{ concurrency: 1 }` for integration tests that share resources, or use dynamic port allocation (`server.listen(0)`).

**4. Coverage masking via barrel exports.** A `index.ts` barrel file re-exports everything from the module. Coverage reports show 100% line coverage on the barrel file (every `export` line executes), masking the fact that the actual implementation files have low coverage. Fix: look at per-file coverage, not aggregate numbers. Exclude barrel files from coverage thresholds.
:::

## :dart: Checkpoint

::: details Question 1 -- ESM mocking mechanics
**Q:** Why must `mock.module()` be called before `import()` for the mock to take effect, and how does this differ from CommonJS mocking?

**A:** In ESM, `import` statements create **live read-only bindings** to the exporting module's variables. Once an `import` statement executes, the binding is established and cannot be reassigned from outside the module. `mock.module()` works by registering a loader hook that intercepts module resolution -- but it can only intercept resolution that *has not yet happened*. A static `import` at the top of the file resolves before any test code runs. In CommonJS, `require()` returns a plain object with mutable properties. You can overwrite `require('fs').readFile` at any time because you are mutating an object property, not a module binding. Additionally, you can delete `require.cache[modulePath]` and re-require to get a fresh (or mocked) copy.
:::

::: details Question 2 -- Coverage internals
**Q:** How does Node's built-in test coverage work under the hood, and why is it more accurate for ESM code than Istanbul/nyc?

**A:** Node's built-in coverage uses V8's native code coverage infrastructure. V8 instruments its own bytecode (Ignition) and optimized code (TurboFan) to track which functions and branches execute. This is the same mechanism Chrome DevTools uses. Because it operates at the V8 bytecode level, it accurately tracks coverage of ESM modules without requiring source code transformation. Istanbul/nyc, by contrast, work by transforming source code (inserting counter statements at every branch and line) before it is loaded. With ESM, this transformation is difficult because ESM loaders do not provide the same hook surface as CJS's `require`. Istanbul can miss or incorrectly instrument dynamically imported ESM code, top-level `await`, and re-exported bindings.
:::

::: details Question 3 -- Test isolation
**Q:** In what way does `node --test` achieve file-level isolation, and what is the trade-off?

**A:** When you run `node --test`, each test file is executed in a separate child process via `child_process.fork()`. This means each file gets its own V8 isolate, its own module cache, its own global state, and its own event loop. No state leaks between files. The trade-off is startup overhead: each child process must boot V8, parse and compile all imported modules, and establish IPC with the parent. For a test suite with hundreds of small test files, this overhead can dominate total runtime. The mitigation is to group related small tests into fewer files, or use `{ concurrency: N }` to run multiple file processes in parallel.
:::

## Key Mental Models

- **`node:test` is not a framework -- it is a runtime capability.** It lives at the same level as `node:fs` or `node:http`. No install, no config, no version mismatch with your runtime.
- **ESM mocking requires mock-before-import.** This is not a limitation of `node:test` -- it is a fundamental property of ES module bindings. Any tool that mocks ESM faces the same constraint.
- **Coverage at the V8 level is the ground truth.** It cannot be fooled by source transforms and works with any module system.
- **File-level isolation via child processes is the right default.** It trades startup time for correctness -- a trade-off worth making for anything beyond trivial test suites.

## Related

- [Structured Logging](./02-structured-logging) -- testing logging output with `node:test`
- [OpenTelemetry](./03-opentelemetry) -- testing instrumented code
