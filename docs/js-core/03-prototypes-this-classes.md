---
title: Prototypes, this Binding & Classes
outline: deep
---

# Prototypes, `this` Binding & Classes

<Badge type="danger" text="Interview: High" /> <Badge type="info" text="Prereqs: Execution Contexts, Closures" />

## 🗣️ In Plain English

::: tip In Plain English
Think of JavaScript objects as people in a **family tree**.

Every person (object) has parents (a prototype). When you ask someone a question they do not know the answer to -- say, "How do you cook lasagna?" -- they turn to their parent and ask. If the parent does not know either, they ask *their* parent, and so on, all the way up to the founding ancestor of the family (that is `Object.prototype`). If nobody in the entire lineage knows, the answer is simply "I have no idea" (`undefined`).

Now, suppose a child *does* know how to cook lasagna because they learned their own recipe. Even though Grandma also has a recipe, the child's recipe is the one that gets used. The child's version **shadows** the ancestor's. Grandma's recipe is still there -- ask Grandma directly and she will tell you -- but when you ask the child, you get the child's version.

Then there is the question of **`this`** -- "who is speaking right now?" Imagine a family has a shared speech called "introduce yourself." The speech says "Hello, my name is `this.name`." Who `this` refers to depends entirely on **who is asked to give the speech**, not who wrote it:

- If you hand the speech to Uncle Bob and say "Bob, read this" -- `this` is Bob. That is **implicit binding** (calling a method on an object).
- If you explicitly point at Aunt Carol and say "Carol, you read it" -- `this` is Carol. That is **explicit binding** (`call`, `apply`, `bind`).
- If you use the speech as a template to create an entirely new person -- `this` is the newborn. That is **`new` binding**.
- If someone just reads the speech out loud in an empty room with no one assigned -- `this` is either nobody (`undefined` in strict mode) or the whole building (`globalThis` in sloppy mode). That is **default binding**.

Arrow functions are like a recorder that was turned on in a specific room. When played back, the voice always sounds like whoever was in that room when the recording was made. You cannot re-record over it. That is **lexical `this`**.

Finally, ES6 `class` syntax is like a formal birth certificate and family registration system. Under the covers, it works exactly like the family tree (prototypes) -- it just provides a cleaner, more structured way to set up the relationships.
:::

## ⚙️ Under the Hood

### The Prototype Chain

Every JavaScript object has an internal `[[Prototype]]` slot pointing to another object (or `null`). This forms a singly-linked chain.

```ts
// run: node --experimental-strip-types demo.ts

const grandparent = { family: "Smith", cook() { return "grandma's recipe"; } };
const parent = Object.create(grandparent); // parent.[[Prototype]] = grandparent
parent.job = "engineer";

const child = Object.create(parent); // child.[[Prototype]] = parent
child.name = "Alice";

// Property lookup walks the chain
console.log(child.name);   // "Alice"       -- own property
console.log(child.job);    // "engineer"    -- found on parent
console.log(child.family); // "Smith"       -- found on grandparent
console.log(child.cook()); // "grandma's recipe" -- method from grandparent

// Chain inspection
console.log(Object.getPrototypeOf(child) === parent);       // true
console.log(Object.getPrototypeOf(parent) === grandparent); // true
console.log(Object.getPrototypeOf(grandparent) === Object.prototype); // true
console.log(Object.getPrototypeOf(Object.prototype));       // null (end of chain)
```

### Property Lookup Mechanics

| Step | Action |
|------|--------|
| 1 | Check the object's **own properties** (`hasOwnProperty`) |
| 2 | If not found, follow `[[Prototype]]` to the next object |
| 3 | Repeat until the property is found or `[[Prototype]]` is `null` |
| 4 | If not found anywhere: return `undefined` (reads) or create on the original object (writes) |

**Shadowing** occurs when you define a property on an object that already exists higher up the chain:

```ts
// run: node --experimental-strip-types demo.ts

const proto = { greet() { return "proto hello"; } };
const obj = Object.create(proto);

console.log(obj.greet());        // "proto hello" -- from prototype
obj.greet = () => "own hello";   // creates an OWN property, does NOT modify proto
console.log(obj.greet());        // "own hello"   -- own property shadows proto's
console.log(proto.greet());      // "proto hello" -- prototype is unchanged

// Verify with hasOwnProperty
console.log(obj.hasOwnProperty("greet"));   // true
console.log(proto.hasOwnProperty("greet")); // true -- both have it
```

### Prototype APIs

| API | Use | Notes |
|-----|-----|-------|
| `Object.create(proto)` | Create object with specified prototype | Preferred way to set up chains |
| `Object.getPrototypeOf(obj)` | Read `[[Prototype]]` | Spec-compliant getter |
| `Object.setPrototypeOf(obj, proto)` | Change `[[Prototype]]` | **Avoid in production** -- deoptimizes V8 |
| `obj.__proto__` | Read/write `[[Prototype]]` | Deprecated accessor, avoid |
| `obj.constructor.prototype` | Navigate via constructor | Brittle -- `constructor` can be overwritten |

### The Four `this` Binding Rules

`this` is determined by **how a function is called**, evaluated in this precedence order:

#### Rule 1: `new` Binding (Highest Precedence)

```ts
// run: node --experimental-strip-types demo.ts

function User(this: any, name: string) {
  // `new` creates a fresh object and binds `this` to it
  this.name = name;
}

const user = new (User as any)("Alice");
console.log(user.name); // "Alice"
// Behind the scenes:
// 1. Create new object: {}
// 2. Set its [[Prototype]] to User.prototype
// 3. Bind `this` = new object
// 4. Execute function body
// 5. Return the object (unless function explicitly returns an object)
```

#### Rule 2: Explicit Binding (`call`, `apply`, `bind`)

```ts
// run: node --experimental-strip-types demo.ts

function introduce(this: { name: string }, greeting: string): string {
  return `${greeting}, I'm ${this.name}`;
}

const alice = { name: "Alice" };
const bob = { name: "Bob" };

// call: invoke immediately with specified `this`
console.log(introduce.call(alice, "Hi"));    // "Hi, I'm Alice"

// apply: same as call, but args as array
console.log(introduce.apply(bob, ["Hey"]));  // "Hey, I'm Bob"

// bind: returns a new function with `this` permanently set
const aliceIntro = introduce.bind(alice);
console.log(aliceIntro("Hello"));            // "Hello, I'm Alice"

// bind is permanent -- cannot be overridden by call
console.log(aliceIntro.call(bob, "Yo"));     // "Yo, I'm Alice" (still Alice!)
```

#### Rule 3: Implicit Binding

```ts
// run: node --experimental-strip-types demo.ts

const team = {
  name: "Engineering",
  describe(this: { name: string }): string {
    return `Team: ${this.name}`;
  },
};

// Implicit: `this` = the object before the dot
console.log(team.describe()); // "Team: Engineering"

// Method extraction loses implicit binding!
const fn = team.describe;
// console.log(fn()); // undefined or TypeError in strict mode
```

#### Rule 4: Default Binding (Lowest Precedence)

```ts
// run: node --experimental-strip-types demo.ts

function showThis(this: unknown): string {
  return String(this);
}

// In strict mode (ESM is always strict): this = undefined
// In sloppy mode: this = globalThis
// Since .ts files with ESM are strict:
console.log(typeof showThis.call(undefined)); // "undefined"
```

### Precedence Summary

| Priority | Rule | `this` = |
|----------|------|----------|
| 1 (highest) | `new` | Newly created object |
| 2 | `call` / `apply` / `bind` | Specified object |
| 3 | `obj.method()` | `obj` |
| 4 (lowest) | Standalone call | `undefined` (strict) / `globalThis` (sloppy) |

### Arrow Functions and Lexical `this`

Arrow functions do **not** have their own `this`. They inherit `this` from the enclosing scope at the time they are created. This binding cannot be changed.

```ts
// run: node --experimental-strip-types demo.ts

const counter = {
  count: 0,
  // Regular method -- `this` depends on call site
  incrementRegular() {
    setTimeout(function (this: unknown) {
      // `this` is NOT counter here -- it's `undefined` (strict) or global (sloppy)
      console.log("regular this:", typeof this); // "undefined"
    }, 0);
  },
  // Arrow in method -- captures `this` from incrementArrow's scope
  incrementArrow() {
    setTimeout(() => {
      // `this` IS counter because the arrow captured it from incrementArrow
      this.count++;
      console.log("arrow this.count:", this.count); // 1
    }, 10);
  },
};

counter.incrementRegular();
counter.incrementArrow();
```

**Critical detail:** `call`, `apply`, and `bind` have **no effect** on an arrow function's `this`:

```ts
// run: node --experimental-strip-types demo.ts

const obj = { value: 42 };

const arrow = () => typeof (this as unknown);
// Trying to rebind:
console.log(arrow.call(obj));  // whatever `this` was at creation, NOT obj
```

### Classes as Syntactic Sugar

`class` syntax desugars to constructor functions + prototype methods:

```ts
// run: node --experimental-strip-types demo.ts

// ES6 class
class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  speak(): string {
    return `${this.name} makes a sound`;
  }
}

// Equivalent ES5 (conceptual)
function AnimalES5(this: any, name: string) {
  this.name = name;
}
AnimalES5.prototype.speak = function (this: any): string {
  return `${this.name} makes a sound`;
};

// Both produce the same prototype chain
const a1 = new Animal("Dog");
const a2 = new (AnimalES5 as any)("Cat");

console.log(a1.speak()); // "Dog makes a sound"
console.log(a2.speak()); // "Cat makes a sound"

// Methods live on the prototype, not the instance
console.log(a1.hasOwnProperty("speak")); // false
console.log(Animal.prototype.hasOwnProperty("speak")); // true

// typeof class is "function"
console.log(typeof Animal); // "function"
```

**Key differences from plain functions:**
- `class` constructors **must** be called with `new` (throws `TypeError` otherwise).
- Class body is always in **strict mode**.
- Methods are **non-enumerable** (unlike manual `.prototype` assignment).
- `class` declarations are **not hoisted** in the same way -- they are in the TDZ like `let`.

### `super` Mechanics and `[[HomeObject]]`

`super` relies on a hidden internal slot called `[[HomeObject]]` on every method defined inside a class (or object literal with method shorthand). `super.method()` resolves to `Object.getPrototypeOf(HomeObject).prototype.method`.

```ts
// run: node --experimental-strip-types demo.ts

class Vehicle {
  describe(): string {
    return "I am a vehicle";
  }
}

class Car extends Vehicle {
  describe(): string {
    // super.describe() uses Car.prototype.describe.[[HomeObject]] = Car.prototype
    // It looks up Object.getPrototypeOf(Car.prototype) = Vehicle.prototype
    return `${super.describe()} (specifically, a car)`;
  }
}

const car = new Car();
console.log(car.describe()); // "I am a vehicle (specifically, a car)"

// You CANNOT extract a method that uses `super` and reassign it:
// const fn = car.describe;
// fn(); // `super` still works because [[HomeObject]] is set at definition time
// But `this` is lost (default binding), so `this.` references would break.
```

**Why you cannot extract `super` into a variable:**

```ts
// run: node --experimental-strip-types demo.ts

class Base {
  greet(): string { return "base"; }
}

class Child extends Base {
  greet(): string {
    // This works:
    const result = super.greet();
    // This does NOT work:
    // const s = super; // SyntaxError: 'super' keyword unexpected here
    return result;
  }
}

console.log(new Child().greet()); // "base"
```

### Common Interview Traps

```ts
// run: node --experimental-strip-types demo.ts

// Trap 1: Method extraction
const obj1 = {
  name: "obj1",
  getName(this: { name: string }): string { return this.name; },
};
const extracted = obj1.getName;
// extracted(); // TypeError or returns undefined -- `this` is not obj1

// Fix: bind it
const bound = obj1.getName.bind(obj1);
console.log(bound()); // "obj1"

// Trap 2: `this` in nested functions
const obj2 = {
  name: "obj2",
  greet(this: { name: string }) {
    function inner(this: unknown) {
      // `this` is NOT obj2 -- it's default binding (undefined in strict)
      return typeof this;
    }
    return inner();
  },
};
console.log(obj2.greet()); // "undefined"

// Fix: use arrow function
const obj3 = {
  name: "obj3",
  greet(this: { name: string }) {
    const inner = () => this.name; // arrow captures `this` from greet
    return inner();
  },
};
console.log(obj3.greet()); // "obj3"

// Trap 3: `this` in callbacks
class Timer {
  seconds: number = 0;

  start(): void {
    // WRONG: regular function loses `this`
    // setInterval(function() { this.seconds++; }, 1000);

    // RIGHT: arrow function preserves `this`
    const id = setInterval(() => {
      this.seconds++;
      if (this.seconds >= 3) {
        clearInterval(id);
        console.log("Timer done:", this.seconds, "seconds"); // 3
      }
    }, 10);
  }
}

new Timer().start();
```

```ts
// run: node --experimental-strip-types demo.ts

// Trap 4: constructor return override
function Weird(this: any) {
  this.a = 1;
  return { b: 2 }; // explicitly returning an object overrides `new`
}

const w = new (Weird as any)();
console.log(w.a); // undefined -- the returned object does NOT have `a`
console.log(w.b); // 2         -- we got the explicitly returned object

// But if you return a primitive, `new` ignores it:
function Normal(this: any) {
  this.a = 1;
  return 42; // primitive return is ignored by `new`
}
const n = new (Normal as any)();
console.log(n.a); // 1 -- normal behavior
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**1. Method extraction in React class components.**
Passing `this.handleClick` as a callback without `.bind(this)` or using an arrow function property is the single most common source of "`this` is undefined" errors in class-based React. The method is extracted from the instance, losing implicit binding.

**2. `Object.setPrototypeOf` in hot paths.**
Changing an object's prototype after creation forces V8 to abandon its "hidden class" (Shape/Map) optimization for that object. The object becomes a dictionary-mode object with significantly slower property access. This deoptimization cascades to all objects that shared the same hidden class.

**3. Prototype pollution.**
If user input can modify `Object.prototype` (e.g., via `__proto__` in parsed JSON), every object in the process inherits the injected properties. This is a critical security vulnerability (CVE category) that has affected Express, Lodash, and many other libraries.

**4. `super` in extracted methods with mixins.**
When using mixin patterns that copy methods between prototypes, the `[[HomeObject]]` slot remains set to the **original** class's prototype. `super` calls resolve against the wrong chain, silently calling the wrong parent method or throwing.
:::

## 🎯 Checkpoint

::: details Question 1 -- Prototype Chain Length
**Q:** How many prototype hops does property lookup take to find `toString` on a plain object `{}`?

**A:** One hop. The object `{}` has no own `toString`. Its `[[Prototype]]` is `Object.prototype`, which has `toString` as an own property. So the engine checks the object (miss), follows one `[[Prototype]]` link to `Object.prototype` (hit). Total: 1 hop.
:::

::: details Question 2 -- `this` Binding Precedence
**Q:** What does this code log?

```ts
function greet(this: any) { return this.name; }
const alice = { name: "Alice" };
const bound = greet.bind(alice);
const obj = { name: "Bob", greet: bound };
console.log(obj.greet());
```

**A:** It logs `"Alice"`. `bind` creates a function with a permanently fixed `this`. Even though `obj.greet()` looks like implicit binding (which would set `this` to `obj`/Bob), explicit binding via `bind` has higher precedence. The only thing that could override `bind` is `new`.
:::

::: details Question 3 -- Arrow Functions and `this`
**Q:** Can you use `call` to change the `this` of an arrow function? Why or why not?

**A:** No. Arrow functions do not have their own `this` binding mechanism. They capture `this` lexically from the enclosing scope at creation time and store it permanently. The `call`, `apply`, and `bind` methods are silently ignored for `this` rebinding on arrow functions (the first argument is simply disregarded). This is defined by the spec: arrow functions have no `[[ThisMode]]` of "lexical" rather than the usual "strict" or "global."
:::

## Key Mental Models

- **Prototype chain = linked list of objects.** Property lookup walks `[[Prototype]]` links until found or `null`. Writes always go on the receiver object (shadowing, not mutation of the prototype).
- **`this` is call-site determined, not definition-site.** The four rules (new > explicit > implicit > default) resolve `this` based on how the function is invoked, not where it is written.
- **Arrow functions are `this`-transparent.** They have no `this` of their own -- they inherit it from the enclosing scope and cannot be rebound.
- **`class` is prototype wiring with guardrails.** It enforces `new`, strict mode, non-enumerable methods, and proper `super` resolution via `[[HomeObject]]` -- all things you had to do manually with ES5 constructors.
- **Never mutate `[[Prototype]]` at runtime.** `Object.setPrototypeOf` deoptimizes hidden classes and makes property access unpredictably slow.

## Related

- [Closures](./02-closures)
- [Execution Contexts](./01-execution-contexts)
- [DI Container (NestJS)](/frameworks/nestjs/01-di-container)
