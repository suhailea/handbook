---
title: Module 1 — Language Foundations
outline: deep
---

# Module 1 — Language Foundations

This module establishes the mental model for how Python works at its core — what the runtime actually does, how objects live in memory, and the syntax rules that shape every line of Python you write. By the end, you should be able to explain what happens between typing `python script.py` and seeing output, why `a = b` doesn't copy anything, and where the float `0.1 + 0.2` result comes from.

## What You'll Learn

- How CPython compiles your source to bytecode and executes it on a stack-based virtual machine
- Python's object model — every value is an object with an identity, a type, and a value
- Why variables are **name bindings** (labels on objects), not boxes that hold data
- The difference between mutable and immutable types and how it affects function arguments, default parameters, and dict keys
- Core syntax mechanics: significant indentation, expressions vs statements, truthiness rules, f-strings, and the walrus operator
- Number internals (arbitrary-precision ints, IEEE 754 float traps, small-int caching)
- String internals (Unicode, encodings, interning) and the `None` singleton

## Pages in This Module

| Page | Topic |
|------|-------|
| [1.1 What Python Actually Is](01-what-python-is) | CPython architecture, bytecode, the VM |
| [1.2 Data Model](02-data-model) | Everything is an object, id/type/value, mutability, name binding |
| [1.3 Core Syntax & Truthiness](03-core-syntax) | Indentation, expressions vs statements, truthiness, f-strings, walrus operator |
| [1.4 Numbers, Strings & None](04-numbers-strings-none) | Int internals, float traps, Unicode, None singleton |

## Prerequisites

::: tip Prerequisites
Basic programming experience in any language. You should be comfortable with variables, functions, loops, and conditionals — but no prior Python knowledge is assumed. If you're coming from JavaScript or TypeScript, you'll find familiar concepts with very different mechanics underneath.
:::
