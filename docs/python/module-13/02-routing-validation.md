---
title: Routing, Params & Validation
outline: deep
---

# Routing, Params & Validation

**Interview weight:** 🔥🔥🔥 | **Python 3.12+** | **FastAPI 0.110+, Pydantic v2** | **Prerequisites:** [13.1 FastAPI Architecture](01-architecture)

## 🗣️ In Plain English

::: tip In Plain English
FastAPI's routing is like a post office sorting machine. Every letter (request) that arrives has an address written on it — the URL path and the HTTP method (GET, POST, etc.). The sorting machine reads that address and sends the letter to the right mailbox (your handler function).

But this is not an ordinary post office. Before the letter reaches the recipient, an inspector opens it up and checks that the contents match the expected format. If the mailbox for "user profile updates" expects a name, an email address, and an age, the inspector verifies all three are present, that the email looks like an email, and that the age is actually a number and not the word "banana." If anything is wrong, the letter is rejected immediately with a detailed note explaining exactly what failed and where — before the recipient ever sees it.

Here is the clever part: the inspection rules are not written in a separate rulebook. They are written directly on the mailbox itself — in the form of labels (type hints) on the recipient's door. The mailbox says "I accept: name (text, 1-100 characters), email (valid email format), age (number, 0-150)." The inspector reads those labels and enforces them automatically. Change the labels, and the inspection rules change too. There is never a mismatch between what the mailbox claims to accept and what actually gets checked.

The post office can also sort incoming mail by more than just the street address. Some information comes from the address itself (path parameters — like the apartment number in the URL). Some comes from sticky notes attached to the envelope (query parameters — filtering and options). Some is inside the envelope (the request body — the main payload). And some is stamped on the outside by the courier (headers and cookies). The inspector knows where to look for each type because the mailbox labels specify it.

When the recipient writes a reply letter, the inspector checks that too — making sure the outgoing response matches the format the sender was promised. Nothing invalid goes in, and nothing malformed goes out.
:::

## ⚙️ Under the Hood

### Route Decorators

Each decorator registers a route with a specific HTTP method. Under the hood, each creates an `APIRoute` and adds it to the app's `Router`:

```python
# route_decorators.py
from fastapi import FastAPI

app = FastAPI()

@app.get("/items")          # GET    — read/list
async def list_items(): ...

@app.post("/items")         # POST   — create
async def create_item(): ...

@app.put("/items/{id}")     # PUT    — full replace
async def replace_item(id: int): ...

@app.patch("/items/{id}")   # PATCH  — partial update
async def update_item(id: int): ...

@app.delete("/items/{id}")  # DELETE — remove
async def delete_item(id: int): ...

# Less common but supported:
@app.options("/items")
async def item_options(): ...

@app.head("/items")
async def item_head(): ...

# run: uvicorn route_decorators:app --reload
```

### Path Parameters

Any `{param_name}` in the path string becomes a path parameter. FastAPI matches it to the function parameter with the same name and validates/converts the type:

```python
# path_params.py
from enum import Enum
from uuid import UUID

from fastapi import FastAPI

app = FastAPI()


# Basic: string (default type)
@app.get("/users/{username}")
async def get_user(username: str):
    return {"username": username}
# GET /users/alice → {"username": "alice"}


# Int conversion + validation
@app.get("/items/{item_id}")
async def get_item(item_id: int):
    return {"item_id": item_id}
# GET /items/42   → {"item_id": 42}
# GET /items/abc  → 422 {"detail": [{"type": "int_parsing", ...}]}


# UUID validation
@app.get("/orders/{order_id}")
async def get_order(order_id: UUID):
    return {"order_id": str(order_id)}
# GET /orders/550e8400-e29b-41d4-a716-446655440000 → works
# GET /orders/not-a-uuid → 422


# Enum — restricts to specific values
class ModelName(str, Enum):
    ALEXNET = "alexnet"
    RESNET = "resnet"
    LENET = "lenet"


@app.get("/models/{model_name}")
async def get_model(model_name: ModelName):
    return {"model": model_name.value}
# GET /models/resnet  → {"model": "resnet"}
# GET /models/vgg     → 422 (not a valid enum member)


# Path parameters with slashes (file paths)
@app.get("/files/{file_path:path}")
async def read_file(file_path: str):
    return {"path": file_path}
# GET /files/home/user/data.csv → {"path": "home/user/data.csv"}

# run: uvicorn path_params:app --reload
```

**Order matters for routes with overlapping patterns:**

```python
# route_order.py
from fastapi import FastAPI

app = FastAPI()

# Fixed path MUST come before parameterized path
@app.get("/users/me")
async def get_current_user():
    return {"user": "current"}

@app.get("/users/{user_id}")
async def get_user(user_id: int):
    return {"user_id": user_id}

# If /users/{user_id} came first, GET /users/me would try to parse "me" as int → 422

# run: uvicorn route_order:app --reload
```

### Query Parameters

Function parameters that are NOT in the path string and are NOT Pydantic models are automatically treated as query parameters:

```python
# query_params.py
from fastapi import FastAPI, Query

app = FastAPI()


# Basic query parameters with defaults
@app.get("/items")
async def list_items(skip: int = 0, limit: int = 10):
    return {"skip": skip, "limit": limit}
# GET /items              → {"skip": 0, "limit": 10}
# GET /items?skip=20      → {"skip": 20, "limit": 10}
# GET /items?limit=5      → {"skip": 0, "limit": 5}


# Required query parameter (no default value)
@app.get("/search")
async def search(q: str):
    return {"query": q}
# GET /search?q=fastapi   → {"query": "fastapi"}
# GET /search              → 422 (q is required)


# Optional query parameter
@app.get("/items/{item_id}")
async def get_item(item_id: int, details: bool | None = None):
    return {"item_id": item_id, "details": details}
# GET /items/42            → {"item_id": 42, "details": null}
# GET /items/42?details=true → {"item_id": 42, "details": true}


# Query() for additional validation and metadata
@app.get("/products")
async def list_products(
    q: str | None = Query(
        default=None,
        min_length=3,
        max_length=50,
        pattern=r"^[a-zA-Z0-9 ]+$",
        title="Search query",
        description="Search term to filter products",
    ),
    page: int = Query(default=1, ge=1, le=1000),
    size: int = Query(default=20, ge=1, le=100),
):
    return {"q": q, "page": page, "size": size}


# List query parameters: ?tag=python&tag=fastapi
@app.get("/articles")
async def list_articles(tag: list[str] = Query(default=[])):
    return {"tags": tag}
# GET /articles?tag=python&tag=fastapi → {"tags": ["python", "fastapi"]}

# run: uvicorn query_params:app --reload
```

### Request Body with Pydantic Models

When a parameter's type is a Pydantic `BaseModel`, FastAPI reads the request body as JSON and validates it:

```python
# request_body.py
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI()


class Address(BaseModel):
    street: str
    city: str
    country: str = "US"


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(pattern=r"^[\w.+-]+@[\w-]+\.[\w.]+$")
    age: int = Field(ge=0, le=150)
    address: Address | None = None  # nested model — optional
    tags: list[str] = Field(default_factory=list, max_length=10)


class UserResponse(BaseModel):
    id: int
    name: str
    email: str


_db: dict[int, UserCreate] = {}
_counter = 0


@app.post("/users", response_model=UserResponse, status_code=201)
async def create_user(user: UserCreate):
    global _counter
    _counter += 1
    _db[_counter] = user
    return UserResponse(id=_counter, name=user.name, email=user.email)

# POST /users
# Body: {
#   "name": "Alice",
#   "email": "alice@example.com",
#   "age": 30,
#   "address": {"street": "123 Main St", "city": "NYC"},
#   "tags": ["admin"]
# }
# → 201 {"id": 1, "name": "Alice", "email": "alice@example.com"}

# Invalid body:
# {"name": "", "email": "not-email", "age": -1}
# → 422 with detailed errors for each field

# run: uvicorn request_body:app --reload
```

### Multiple Body Parameters and Body()

When you need multiple distinct objects in the request body, or want to embed a single model under a key:

```python
# multi_body.py
from fastapi import Body, FastAPI
from pydantic import BaseModel

app = FastAPI()


class Item(BaseModel):
    name: str
    price: float


class User(BaseModel):
    username: str


# Multiple body params → FastAPI expects a JSON object with keys matching param names
@app.put("/items/{item_id}")
async def update_item(item_id: int, item: Item, user: User):
    return {"item_id": item_id, "item": item, "user": user}
# Expected body:
# {
#   "item": {"name": "Widget", "price": 9.99},
#   "user": {"username": "alice"}
# }


# Singular body values alongside models
@app.post("/offers")
async def create_offer(
    item: Item,
    importance: int = Body(gt=0, le=10),  # singular value in body
):
    return {"item": item, "importance": importance}
# Expected body:
# {
#   "item": {"name": "Widget", "price": 9.99},
#   "importance": 5
# }


# embed=True: wraps the model under its parameter name even when it's the only body param
@app.post("/items-embedded")
async def create_embedded(item: Item = Body(embed=True)):
    return item
# Expected body: {"item": {"name": "Widget", "price": 9.99}}
# Without embed: {"name": "Widget", "price": 9.99}

# run: uvicorn multi_body:app --reload
```

### Headers and Cookies

```python
# headers_cookies.py
from fastapi import Cookie, FastAPI, Header

app = FastAPI()


@app.get("/info")
async def get_info(
    user_agent: str | None = Header(default=None),
    x_request_id: str | None = Header(default=None),
    accept_language: str | None = Header(default=None),
    session_id: str | None = Cookie(default=None),
):
    return {
        "user_agent": user_agent,
        "x_request_id": x_request_id,
        "accept_language": accept_language,
        "session_id": session_id,
    }

# Header() automatically converts underscores to hyphens:
#   user_agent     → reads "User-Agent" header
#   x_request_id   → reads "X-Request-Id" header
#
# To disable this conversion:
#   x_token: str = Header(convert_underscores=False)

# run: uvicorn headers_cookies:app --reload
# Test: curl -H "X-Request-Id: abc123" http://localhost:8000/info
```

### Form Data and File Uploads

```python
# forms_files.py
from fastapi import FastAPI, File, Form, UploadFile

app = FastAPI()


# Form data (application/x-www-form-urlencoded)
@app.post("/login")
async def login(username: str = Form(), password: str = Form()):
    return {"username": username}
# Note: Form() requires `python-multipart` package (included in fastapi[standard])


# File upload — small files (read into memory)
@app.post("/upload-bytes")
async def upload_bytes(file: bytes = File()):
    return {"size": len(file)}


# File upload — large files (UploadFile uses spooled temp file)
@app.post("/upload")
async def upload(file: UploadFile):
    contents = await file.read()
    return {
        "filename": file.filename,
        "content_type": file.content_type,
        "size": len(contents),
    }


# Multiple files
@app.post("/upload-multiple")
async def upload_multiple(files: list[UploadFile]):
    return {"filenames": [f.filename for f in files]}


# Form data + file together
@app.post("/profile")
async def create_profile(
    username: str = Form(),
    bio: str = Form(default=""),
    avatar: UploadFile | None = File(default=None),
):
    result = {"username": username, "bio": bio}
    if avatar:
        result["avatar_filename"] = avatar.filename
    return result

# run: uvicorn forms_files:app --reload
# Test: curl -F "file=@myfile.txt" http://localhost:8000/upload
```

**`bytes` vs `UploadFile`:**

| | `bytes = File()` | `UploadFile` |
|---|---|---|
| Storage | Entire file in memory | Spooled to disk if > 1MB |
| Good for | Small files (< few MB) | Large files (any size) |
| Access | Direct `bytes` | Async `.read()`, `.seek()`, `.close()` |
| Metadata | None | `.filename`, `.content_type`, `.size` |

### Response Model

The `response_model` parameter (or return type annotation) controls what gets sent back to the client:

```python
# response_model.py
from fastapi import FastAPI
from pydantic import BaseModel, EmailStr

app = FastAPI()


class UserInDB(BaseModel):
    id: int
    name: str
    email: str
    hashed_password: str  # sensitive — must not leak


class UserPublic(BaseModel):
    id: int
    name: str
    email: str


_fake_db: dict[int, UserInDB] = {
    1: UserInDB(
        id=1,
        name="Alice",
        email="alice@example.com",
        hashed_password="$2b$12$secret_hash",
    )
}


# response_model filters the output — hashed_password is stripped
@app.get("/users/{user_id}", response_model=UserPublic)
async def get_user(user_id: int):
    user = _fake_db.get(user_id)
    if not user:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")
    return user  # returns UserInDB, but response_model filters to UserPublic


# response_model_exclude — ad-hoc field exclusion
@app.get("/users/{user_id}/admin", response_model=UserInDB, response_model_exclude={"hashed_password"})
async def get_user_admin(user_id: int):
    return _fake_db.get(user_id)


# Using return type annotation instead of response_model parameter
@app.get("/users-v2/{user_id}")
async def get_user_v2(user_id: int) -> UserPublic:
    user = _fake_db.get(user_id)
    if not user:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")
    return user

# run: uvicorn response_model:app --reload
```

### Status Codes and Multiple Response Types

```python
# status_codes.py
from fastapi import FastAPI, HTTPException
from fastapi import status as http_status
from pydantic import BaseModel

app = FastAPI()


class Item(BaseModel):
    id: int
    name: str


class ErrorDetail(BaseModel):
    detail: str


# Custom status code
@app.post("/items", status_code=http_status.HTTP_201_CREATED, response_model=Item)
async def create_item(name: str):
    return Item(id=1, name=name)


# Document multiple response types for OpenAPI
@app.get(
    "/items/{item_id}",
    response_model=Item,
    responses={
        404: {"model": ErrorDetail, "description": "Item not found"},
        422: {"description": "Validation error"},
    },
)
async def get_item(item_id: int):
    if item_id > 100:
        raise HTTPException(status_code=404, detail="Item not found")
    return Item(id=item_id, name="Widget")

# run: uvicorn status_codes:app --reload
```

### Validation Error Responses

When validation fails, FastAPI returns a `422 Unprocessable Entity` with a structured error body. This is powered by Pydantic's `ValidationError`:

```python
# validation_errors.py
from fastapi import FastAPI, Query
from pydantic import BaseModel, Field

app = FastAPI()


class CreateUser(BaseModel):
    name: str = Field(min_length=1)
    age: int = Field(ge=0, le=150)
    email: str


@app.post("/users")
async def create_user(user: CreateUser):
    return user


# Sending invalid data:
# POST /users {"name": "", "age": -5, "email": 123}
#
# Response (422):
# {
#   "detail": [
#     {
#       "type": "string_too_short",
#       "loc": ["body", "name"],      ← location: body.name
#       "msg": "String should have at least 1 character",
#       "input": "",
#       "ctx": {"min_length": 1}
#     },
#     {
#       "type": "greater_than_equal",
#       "loc": ["body", "age"],       ← location: body.age
#       "msg": "Input should be greater than or equal to 0",
#       "input": -5,
#       "ctx": {"ge": 0}
#     },
#     {
#       "type": "string_type",
#       "loc": ["body", "email"],     ← location: body.email
#       "msg": "Input should be a valid string",
#       "input": 123
#     }
#   ]
# }
#
# The "loc" field tells you exactly where the error is:
#   ["body", "name"]         → request body, field "name"
#   ["query", "page"]        → query parameter "page"
#   ["path", "item_id"]      → path parameter "item_id"
#   ["header", "x-token"]    → header "x-token"

# run: uvicorn validation_errors:app --reload
```

### Custom Validators on Pydantic Models

```python
# custom_validators.py
from pydantic import BaseModel, Field, field_validator, model_validator
from fastapi import FastAPI

app = FastAPI()


class BookingRequest(BaseModel):
    check_in: str   # ISO date string
    check_out: str  # ISO date string
    guests: int = Field(ge=1, le=20)
    room_type: str

    @field_validator("room_type")
    @classmethod
    def validate_room_type(cls, v: str) -> str:
        allowed = {"single", "double", "suite"}
        if v.lower() not in allowed:
            raise ValueError(f"room_type must be one of {allowed}")
        return v.lower()

    @field_validator("check_in", "check_out")
    @classmethod
    def validate_date_format(cls, v: str) -> str:
        from datetime import date
        try:
            date.fromisoformat(v)
        except ValueError:
            raise ValueError("Date must be in YYYY-MM-DD format")
        return v

    @model_validator(mode="after")
    def check_dates(self) -> "BookingRequest":
        from datetime import date
        if date.fromisoformat(self.check_out) <= date.fromisoformat(self.check_in):
            raise ValueError("check_out must be after check_in")
        return self


@app.post("/bookings")
async def create_booking(booking: BookingRequest):
    return {"status": "confirmed", "booking": booking}

# POST /bookings
# {"check_in": "2026-08-10", "check_out": "2026-08-08", "guests": 2, "room_type": "suite"}
# → 422: "check_out must be after check_in"

# run: uvicorn custom_validators:app --reload
```

### APIRouter: Organizing Routes

For larger applications, split routes into separate modules using `APIRouter`:

```python
# routers/users.py
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(
    prefix="/users",           # all routes in this router start with /users
    tags=["users"],            # groups them in the OpenAPI docs
    responses={404: {"description": "User not found"}},
)


class User(BaseModel):
    id: int
    name: str


@router.get("/", response_model=list[User])
async def list_users():
    return [User(id=1, name="Alice"), User(id=2, name="Bob")]


@router.get("/{user_id}", response_model=User)
async def get_user(user_id: int):
    return User(id=user_id, name="Alice")


@router.post("/", response_model=User, status_code=201)
async def create_user(name: str):
    return User(id=3, name=name)
```

```python
# main_with_router.py
from fastapi import FastAPI

# In a real project, this would be: from routers.users import router as users_router
# For this demo, we define the router inline:
from fastapi import APIRouter
from pydantic import BaseModel

users_router = APIRouter(prefix="/users", tags=["users"])

class User(BaseModel):
    id: int
    name: str

@users_router.get("/", response_model=list[User])
async def list_users():
    return [User(id=1, name="Alice")]

@users_router.get("/{user_id}", response_model=User)
async def get_user(user_id: int):
    return User(id=user_id, name="Alice")


items_router = APIRouter(prefix="/items", tags=["items"])

class Item(BaseModel):
    id: int
    name: str

@items_router.get("/", response_model=list[Item])
async def list_items():
    return [Item(id=1, name="Widget")]


# Assemble the application
app = FastAPI(title="Organized API")
app.include_router(users_router)
app.include_router(items_router)

# Routes registered:
#   GET  /users/
#   GET  /users/{user_id}
#   GET  /items/
# Each group appears separately in /docs

# run: uvicorn main_with_router:app --reload
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Forgetting `response_model` and leaking sensitive fields.**
You return a database model (which includes `hashed_password`, `internal_notes`, `ssn`) and forget to set `response_model` to a public schema. FastAPI happily serializes the entire object to JSON. This is the most common data-leak vector in FastAPI apps. The fix is simple but must be enforced: always define separate request and response models, and always set `response_model`. Use a linter rule or code review checklist. Some teams use a `model_config = {"extra": "forbid"}` on response models to catch accidental extra fields.

**2. 422 errors in production with no logging.**
FastAPI returns a 422 with detailed validation errors to the client, but by default does not log these errors server-side. In production, if a mobile app sends malformed data, you see HTTP 422 in your access logs but have no idea what field failed or why. Fix: add a custom exception handler for `RequestValidationError` that logs the error details before returning the response:

```python
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
import logging

logger = logging.getLogger(__name__)
app = FastAPI()

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning("Validation error on %s %s: %s", request.method, request.url.path, exc.errors())
    return JSONResponse(status_code=422, content={"detail": exc.errors()})
```

**3. Route ordering — parameterized routes shadow fixed routes.**
If you define `@app.get("/users/{user_id}")` before `@app.get("/users/me")`, then `GET /users/me` tries to parse `"me"` as the type of `user_id`. If `user_id` is `int`, you get a 422. If it is `str`, you get the wrong handler entirely. FastAPI matches routes in registration order. Fixed paths must be registered before parameterized paths.
:::

## 🎯 Checkpoint

::: details Question 1 — How does FastAPI decide where a parameter comes from?
**Q:** Given a handler `async def f(user_id: int, q: str | None = None, body: CreateUser)`, how does FastAPI know that `user_id` is a path param, `q` is a query param, and `body` is a request body param — without you explicitly saying so?

**A:** FastAPI applies a set of rules based on the function signature and the route path:

1. **Path parameters:** If the parameter name appears in the path template (e.g., `"/users/{user_id}"`), it is a path parameter. FastAPI matches `user_id` in the signature to `{user_id}` in the path.

2. **Body parameters:** If the parameter's type annotation is a Pydantic `BaseModel` subclass (or `list[SomeModel]`, `dict`, etc.), it is a request body parameter. `CreateUser` is a `BaseModel`, so FastAPI reads it from the JSON body.

3. **Query parameters:** Everything else — parameters with scalar types (`int`, `str`, `float`, `bool`) that are NOT in the path template — defaults to query parameters. `q: str | None = None` is not in the path and is not a model, so it is a query parameter.

4. **Explicit overrides:** You can force a parameter's source using `Query()`, `Header()`, `Cookie()`, `Body()`, or `Path()` — these override the automatic detection. For example, `importance: int = Body()` makes a scalar value come from the body instead of the query.

This is why type hints drive everything in FastAPI — the type itself determines the extraction strategy.
:::

::: details Question 2 — 422 vs 400 for validation errors
**Q:** FastAPI returns 422 (Unprocessable Entity) for validation errors, not 400 (Bad Request). Some API consumers and API gateways expect 400 for malformed input. How would you change this behavior, and what is the rationale behind 422?

**A:** FastAPI uses 422 because the OpenAPI specification (which FastAPI follows strictly) defines 422 as the status code for request validation errors. 422 means "the server understands the content type and the syntax is correct, but the content is semantically invalid" — e.g., JSON parses fine but `age` is negative. 400 means "the request is malformed at the syntax level."

To change the behavior, override the `RequestValidationError` handler:

```python
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

app = FastAPI()

@app.exception_handler(RequestValidationError)
async def custom_validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=400, content={"errors": exc.errors()})
```

This changes the status code for all validation errors globally. The trade-off: your `/docs` Swagger UI still documents 422 as the validation error response (since that is what OpenAPI specifies), creating a mismatch. You can fix this by also customizing the `responses` parameter on your routes.
:::

::: details Question 3 — Nested model validation
**Q:** If a request body has a deeply nested structure (e.g., `Order` containing `list[LineItem]`, each `LineItem` containing a `Product`), and a field three levels deep fails validation, does the client get enough information to find the exact error? How?

**A:** Yes. Pydantic's validation errors include a `loc` (location) field that traces the exact path to the error through the nested structure. For example, if the third line item's product name is too short:

```json
{
  "detail": [
    {
      "type": "string_too_short",
      "loc": ["body", "line_items", 2, "product", "name"],
      "msg": "String should have at least 1 character",
      "input": ""
    }
  ]
}
```

The `loc` array reads as: body → `line_items` field → index 2 (third item) → `product` field → `name` field. This gives the client an exact JSON path to the invalid value, regardless of nesting depth. Each element in `loc` is either a string (field name) or an integer (list index).
:::

## Key Mental Models

- **Type hints are the single source of truth.** Parameter location, type coercion, validation constraints, and API documentation all flow from the function signature — no duplication.
- **Path param > Body model > Query param.** FastAPI decides where to look based on: is it in the path template? Is it a Pydantic model? Otherwise, query parameter. Explicit markers (`Query()`, `Body()`, `Header()`) override this.
- **Separate your input and output models.** Never return your database model or creation model directly — define a response model that excludes sensitive fields. This is the primary defense against data leaks.
- **Route registration order is match order.** Fixed paths (`/users/me`) must be registered before parameterized paths (`/users/{user_id}`) or they will never match.
- **422 errors are your validation firewall.** They stop invalid data before your handler runs. Log them server-side — the client gets details, but your logs often do not by default.

## Related

- [13.1 FastAPI Architecture](01-architecture) — how routing fits into the Starlette/FastAPI layering
- [13.3 Dependency Injection](03-dependency-injection) — `Depends()` adds another parameter source beyond path/query/body
- [13.4 Middleware, CORS & Error Handling](04-middleware-errors) — custom exception handlers for 422 and other errors
- [13.8 Testing FastAPI Applications](08-testing) — testing routes with `TestClient`
