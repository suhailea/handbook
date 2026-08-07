---
title: "Auth — JWT, OAuth2 & Security"
outline: deep
---

# Auth — JWT, OAuth2 & Security

Interview weight: 🔥🔥🔥 | FastAPI 0.100+ / Python 3.12+ | Prerequisites: [Dependency Injection](./03-dependency-injection.md), [Middleware, CORS & Error Handling](./04-middleware-errors.md)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you're visiting a secure office building for a series of meetings.

At the **front desk** (the login endpoint), you present your government-issued ID — your driver's license with your photo (username and password). The receptionist doesn't just glance at it; she checks it against a list of authorized visitors, confirms your face matches the photo, and verifies you're expected today.

Once verified, she doesn't let you keep your government ID out. Instead, she prints you a **visitor badge** (a JWT token). This badge has your name, your photo, your company, your access level ("Floor 3 only" or "All floors"), and critically, an **expiration time** — maybe it's only valid until 5 PM today.

Now, for every door you approach in the building, there's a guard (a dependency function). The guard **never calls the front desk again**. That would be slow and unnecessary. Instead, the guard does three quick checks on your badge:

1. **Is it genuine?** The badge has a tamper-evident hologram (the cryptographic signature). If someone photocopied a badge and changed the access level, the hologram wouldn't match. The guard can verify authenticity instantly without contacting the front desk.

2. **Has it expired?** The guard checks the timestamp. If it's past 5 PM, badge rejected — go back to the front desk and get a new one.

3. **Does your access level allow you through this specific door?** Floor 3 badge can't open Floor 7. These are **scopes** — fine-grained permissions encoded in the badge itself.

What about the badge's actual content? It's not sealed in an opaque envelope. Anyone can read what's printed on it (the JWT payload is just base64-encoded, not encrypted). The security isn't in hiding the content — it's in the **hologram** (signature) that proves nobody tampered with it. You wouldn't put your Social Security number on a visitor badge for this exact reason: readable doesn't mean secret.

If you need access to a restricted floor you didn't originally request, you don't get an upgraded badge at the door. You go **back to the front desk** and request a new badge with broader access. That's why tokens have limited scopes — principle of least privilege.

Some buildings also use a different system: instead of visitor badges, they use **key cards** (API keys). No front desk visit needed — you were issued the card ahead of time. It's simpler but less flexible: key cards don't expire on their own, they don't carry fine-grained permissions, and if someone steals yours, it works until the building manager manually deactivates it.
:::

## ⚙️ Under the Hood

### FastAPI's Security Utilities

FastAPI provides several security scheme classes in `fastapi.security`. These serve two purposes: they extract credentials from the request, and they declare the security scheme in the OpenAPI spec (which powers the "Authorize" button in `/docs`).

```python
from fastapi.security import (
    OAuth2PasswordBearer,      # Extracts Bearer token from Authorization header
    OAuth2PasswordRequestForm, # Form body for username/password login
    APIKeyHeader,              # Extracts API key from a custom header
    APIKeyCookie,              # Extracts API key from a cookie
    HTTPBearer,                # Generic HTTP Bearer scheme
)
```

### OAuth2 Password Flow: End-to-End

Here's a complete, production-shaped implementation:

```python
# run: uvicorn app:app --reload
# pip install "fastapi[standard]" "python-jose[cryptography]" "passlib[bcrypt]"
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

# --- Configuration ---
SECRET_KEY = "09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7"  # openssl rand -hex 32
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# --- Password hashing ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# --- OAuth2 scheme ---
# tokenUrl must match the path of the login endpoint.
# This tells the OpenAPI UI where to send credentials.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

app = FastAPI()


# --- Models ---
class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    username: str | None = None
    scopes: list[str] = []


class User(BaseModel):
    username: str
    email: str
    full_name: str
    disabled: bool = False


class UserInDB(User):
    hashed_password: str


# --- Fake user database ---
fake_users_db: dict[str, dict] = {
    "alice": {
        "username": "alice",
        "full_name": "Alice Wonderland",
        "email": "alice@example.com",
        "hashed_password": pwd_context.hash("secret123"),
        "disabled": False,
    },
}


# --- Helper functions ---
def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Compare a plain password against its bcrypt hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_user(db: dict, username: str) -> UserInDB | None:
    if username in db:
        return UserInDB(**db[username])
    return None


def authenticate_user(db: dict, username: str, password: str) -> UserInDB | None:
    user = get_user(db, username)
    if user is None:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Encode a JWT with an expiration claim."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# --- Dependency chain ---
async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
) -> User:
    """Decode the JWT, validate it, and return the user."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception

    user = get_user(fake_users_db, token_data.username)
    if user is None:
        raise credentials_exception
    return user


async def get_current_active_user(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Reject disabled users even if their token is valid."""
    if current_user.disabled:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user


# --- Endpoints ---
@app.post("/token", response_model=Token)
async def login(form_data: Annotated[OAuth2PasswordRequestForm, Depends()]) -> Token:
    """
    OAuth2-compatible login endpoint.
    Receives form data (not JSON): username & password fields.
    """
    user = authenticate_user(fake_users_db, form_data.username, form_data.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(
        data={"sub": user.username},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return Token(access_token=access_token, token_type="bearer")


@app.get("/users/me", response_model=User)
async def read_users_me(
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    return current_user
```

### JWT Structure: What's Actually Inside

A JWT is three base64url-encoded segments separated by dots: `header.payload.signature`.

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.    ← Header
eyJzdWIiOiJhbGljZSIsImV4cCI6MTcwMH0.       ← Payload
SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c  ← Signature
```

| Segment | Contains | Encrypted? |
|---|---|---|
| **Header** | `{"alg": "HS256", "typ": "JWT"}` — signing algorithm | No, base64 only |
| **Payload** | Claims: `sub` (subject), `exp` (expiration), custom data | No, base64 only |
| **Signature** | `HMAC-SHA256(base64(header) + "." + base64(payload), secret)` | This IS the security |

**Critical point:** the payload is **not encrypted**. Anyone who has the token can decode the payload and read its contents. The signature only guarantees **integrity** (nobody tampered with it) and **authenticity** (it was issued by someone who knows the secret key). Never put sensitive data (passwords, SSNs, PII) in JWT claims.

### Token Expiration and Refresh Pattern

```python
from datetime import datetime, timedelta, timezone

from jose import jwt, ExpiredSignatureError

SECRET_KEY = "your-secret-key"
ALGORITHM = "HS256"


def create_token_pair(username: str) -> dict[str, str]:
    """Create both access and refresh tokens."""
    # Short-lived access token — used for API calls
    access_token = jwt.encode(
        {
            "sub": username,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
            "type": "access",
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    # Long-lived refresh token — used only to get new access tokens
    refresh_token = jwt.encode(
        {
            "sub": username,
            "exp": datetime.now(timezone.utc) + timedelta(days=7),
            "type": "refresh",
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    return {"access_token": access_token, "refresh_token": refresh_token}


def decode_token(token: str) -> dict:
    """Decode and validate a token. Raises on expiry or tampering."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except ExpiredSignatureError:
        raise ValueError("Token has expired — re-authenticate or use refresh token")
```

The refresh token pattern works like this: the access token is short-lived (15-30 minutes). When it expires, the client sends the refresh token to a dedicated `/refresh` endpoint and receives a new access token without re-entering credentials. The refresh token itself expires after days or weeks, forcing a full re-login.

### Password Hashing: Never Store Plaintext

```python
from passlib.context import CryptContext

# bcrypt is the recommended algorithm for password hashing.
# It's intentionally slow (~100ms per hash), making brute-force infeasible.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Hash a password for storage
hashed = pwd_context.hash("my-secret-password")
# Result: "$2b$12$LJ3m4ys3Lz..." — includes algorithm, cost factor, salt, and hash

# Verify a password against its hash
is_valid: bool = pwd_context.verify("my-secret-password", hashed)  # True
is_valid = pwd_context.verify("wrong-password", hashed)             # False
```

**Why bcrypt specifically?** It includes a configurable cost factor (number of hashing rounds). As hardware gets faster, you increase the cost. The salt is embedded in the hash output, so you don't manage it separately. The `deprecated="auto"` setting lets you migrate between algorithms over time — when a user logs in, passlib re-hashes with the current scheme if their hash uses an older one.

### OAuth2 Scopes for Fine-Grained Permissions

Scopes let you restrict what a token can do, not just who holds it:

```python
# run: uvicorn app:app --reload
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Security, status
from fastapi.security import OAuth2PasswordBearer, SecurityScopes
from jose import JWTError, jwt
from pydantic import BaseModel

app = FastAPI()

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="token",
    scopes={
        "users:read": "Read user information",
        "users:write": "Modify user information",
        "admin": "Full administrative access",
    },
)

SECRET_KEY = "your-secret-key"
ALGORITHM = "HS256"


class User(BaseModel):
    username: str
    scopes: list[str] = []


async def get_current_user(
    security_scopes: SecurityScopes,
    token: Annotated[str, Depends(oauth2_scheme)],
) -> User:
    """Validate token AND check that it carries the required scopes."""
    # Build the WWW-Authenticate header value including required scopes
    if security_scopes.scopes:
        authenticate_value = f'Bearer scope="{security_scopes.scope_str}"'
    else:
        authenticate_value = "Bearer"

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": authenticate_value},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str | None = payload.get("sub")
        token_scopes: list[str] = payload.get("scopes", [])
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Check that the token's scopes include all required scopes
    for scope in security_scopes.scopes:
        if scope not in token_scopes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Not enough permissions. Required scope: {scope}",
                headers={"WWW-Authenticate": authenticate_value},
            )

    return User(username=username, scopes=token_scopes)


@app.get("/users/me")
async def read_own_profile(
    # Security() is like Depends() but also declares required scopes
    current_user: Annotated[User, Security(get_current_user, scopes=["users:read"])],
) -> User:
    return current_user


@app.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    current_user: Annotated[User, Security(get_current_user, scopes=["admin"])],
) -> dict[str, str]:
    return {"deleted": str(user_id), "by": current_user.username}
```

When you open `/docs`, the "Authorize" dialog shows checkboxes for each scope. The token issued during login must include the scopes the endpoint requires — if it doesn't, you get a 403.

### API Key Authentication

For machine-to-machine communication where OAuth2 is overkill:

```python
# run: uvicorn app:app --reload
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Security, status
from fastapi.security import APIKeyHeader

app = FastAPI()

# Declares that the API key should be in the X-API-Key header
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=True)

# In production, these would be in a database with associated permissions
VALID_API_KEYS: dict[str, str] = {
    "sk-abc123": "service-a",
    "sk-def456": "service-b",
}


async def verify_api_key(
    api_key: Annotated[str, Security(api_key_header)],
) -> str:
    """Validate the API key and return the associated service name."""
    service = VALID_API_KEYS.get(api_key)
    if service is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )
    return service


@app.get("/internal/status")
async def internal_status(
    service: Annotated[str, Depends(verify_api_key)],
) -> dict[str, str]:
    return {"status": "ok", "caller": service}
```

### The OpenAPI Security Integration

FastAPI automatically generates OpenAPI security schemes from your security utilities. When you use `OAuth2PasswordBearer(tokenUrl="token")`, the `/docs` page shows an "Authorize" button. Clicking it presents a login form that POSTs to your `tokenUrl`, stores the returned token, and attaches it as `Authorization: Bearer <token>` to subsequent requests — all without writing any frontend code.

This works because FastAPI maps each security class to an OpenAPI security scheme:

| FastAPI class | OpenAPI scheme type | UI behavior |
|---|---|---|
| `OAuth2PasswordBearer` | `oauth2` (password flow) | Login form with username/password |
| `HTTPBearer` | `http` (bearer) | Text field for raw token |
| `APIKeyHeader` | `apiKey` (header) | Text field for API key |
| `APIKeyCookie` | `apiKey` (cookie) | Text field for cookie value |

### Security Best Practices

**HTTPS only:** JWTs are bearer tokens — anyone who intercepts one can use it. Always serve your API over TLS. Use `HTTPSRedirectMiddleware` in production.

**Token storage in SPAs:**

| Strategy | CSRF risk | XSS risk | Recommendation |
|---|---|---|---|
| `localStorage` | None | High (JS can read it) | Avoid for sensitive apps |
| `sessionStorage` | None | High | Slightly better (tab-scoped) |
| `HttpOnly` cookie | Yes (mitigate with SameSite) | None (JS can't access) | Preferred |
| In-memory variable | None | Medium | Good for short sessions |

**HttpOnly cookies vs Bearer tokens:**

```python
from fastapi import Response


@app.post("/login")
async def login_with_cookie(response: Response) -> dict[str, str]:
    token = create_access_token(data={"sub": "alice"})
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,     # JavaScript cannot access this cookie
        secure=True,       # Only sent over HTTPS
        samesite="lax",    # CSRF protection: cookie not sent on cross-origin POST
        max_age=1800,      # 30 minutes
    )
    return {"message": "logged in"}
```

**Constant-time comparison:** when comparing tokens or secrets manually, always use `hmac.compare_digest()` instead of `==` to prevent timing attacks:

```python
import hmac

def is_valid_key(provided: str, expected: str) -> bool:
    return hmac.compare_digest(provided.encode(), expected.encode())
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. JWT secret key leaked or too weak.**
Symptom: tokens pass validation even when you didn't issue them — an attacker is forging tokens. If `SECRET_KEY` is a short, guessable string (like `"secret"` or `"changeme"`), it can be brute-forced offline since the attacker has the algorithm and the token. Generate keys with `openssl rand -hex 32` (256 bits). Rotate keys by supporting multiple valid keys during a transition period — decode with each key until one works, sign new tokens only with the new key.

**2. No token expiration or absurdly long expiry.**
Symptom: a compromised token grants access indefinitely. If you skip the `exp` claim, the token never expires. Even with `exp`, setting it to 30 days means a stolen token is valid for a month. Use short access tokens (15-30 minutes) with refresh tokens (7 days). When a user's permissions change or they're banned, short-lived access tokens limit the window of stale permissions.

**3. Storing sensitive data in JWT payload.**
Symptom: intercepted JWTs leak user emails, roles, or internal IDs. Since the payload is base64, not encrypted, anyone with the token (browser DevTools, proxy logs, error reports that include headers) can decode it. Only store the minimum: `sub` (user ID), `exp`, and `scopes`. Look up everything else from the database using the `sub` claim.

**4. Password hash misconfiguration causing login to be instant (or take 10 seconds).**
Symptom: logins are suspiciously fast (bcrypt rounds too low or hashing skipped) or painfully slow (rounds too high). The default bcrypt cost factor of 12 takes ~250ms. Going to 14+ can take seconds per login. Going below 10 weakens the protection. Monitor login endpoint latency — if `p99 < 50ms`, you may not actually be hashing.
:::

## 🎯 Checkpoint

::: details Question 1 — JWT verification without a database call
**Q:** When a request arrives with a Bearer token, the `get_current_user` dependency decodes the JWT and extracts the username. Why doesn't it need to call an external auth service or database to verify the token's authenticity?

**A:** The JWT's integrity is verified **locally** using the signature. The signature is an HMAC (or RSA/ECDSA) digest of the header and payload, computed with the server's secret key. When the server calls `jwt.decode()`, it recomputes the signature using the same secret key and compares it to the signature in the token. If they match, the token was issued by someone who knew the secret and hasn't been tampered with. This is the entire point of signed tokens — verification is a local cryptographic operation, not a network call. The tradeoff: you can't revoke individual tokens before expiry without maintaining a denylist (which reintroduces a database lookup).
:::

::: details Question 2 — OAuth2 scopes vs role-based access
**Q:** What's the practical difference between checking `if current_user.role == "admin"` in your endpoint and using `Security(get_current_user, scopes=["admin"])`? When would you prefer one over the other?

**A:** **Role check in the handler:** simple, flexible, the role is fetched from the database and is always current. But it requires a database lookup on every request, the check logic is scattered across endpoints, and it doesn't integrate with OpenAPI documentation.

**OAuth2 scopes in the token:** the scope is embedded in the JWT at login time. It's checked in the dependency without a database call, it's declarative (visible in the function signature and OpenAPI spec), and FastAPI generates proper 403 responses with `WWW-Authenticate` headers. But scopes are frozen when the token is issued — if you revoke admin access, the user's existing tokens still carry the `admin` scope until they expire.

**Prefer scopes** for coarse-grained, stable permissions (user, admin, service). **Prefer database roles** for fine-grained, frequently-changing permissions (access to specific resources, feature flags). Many production systems use both: scopes for broad authorization, database lookup for resource-level access control.
:::

::: details Question 3 — Password hashing verification
**Q:** Given that bcrypt generates a different hash every time for the same password (because of the random salt), how does `pwd_context.verify(plain, hashed)` still return `True`?

**A:** The salt is embedded in the bcrypt hash string itself. A bcrypt hash looks like `$2b$12$SALT_HERE_22_CHARS_HASH_HERE_31_CHARS`. When `verify()` is called, passlib extracts the salt from the stored hash, re-hashes the provided plaintext password with that same salt and the same cost factor, and then compares the resulting hash to the stored hash. If they match, the password is correct. The salt prevents rainbow table attacks (precomputed hash lookups), and embedding it in the output means you don't need a separate salt column in your database.
:::

## Key Mental Models

- **JWT is a signed envelope, not a sealed one.** Anyone can read the payload; the signature only proves it hasn't been tampered with. Never store secrets in claims.
- **The dependency chain IS your security architecture.** `Depends(get_current_active_user)` is not boilerplate — it's a composable, testable, declarative security boundary enforced by the framework.
- **Short access tokens + refresh tokens = revocability.** You can't revoke a JWT before expiry (without a denylist), so make expiry short and use refresh tokens for continuity.
- **Password hashing must be slow on purpose.** bcrypt's ~250ms per hash is a feature, not a bug — it makes brute-force attacks computationally infeasible.
- **OpenAPI integration is free security documentation.** FastAPI's security classes auto-generate the "Authorize" button and security scheme declarations — this is both a testing tool and an API contract.

## Related

- [Middleware, CORS & Error Handling](./04-middleware-errors.md) — middleware-level security patterns and CORS configuration
- [Dependency Injection](./03-dependency-injection.md) — how `Depends()` and `Security()` chains work under the hood
- [Database Integration](./06-database-integration.md) — storing users and hashed passwords in a real database
