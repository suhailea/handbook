---
title: "RBAC, ABAC & Authorization Patterns"
outline: deep
---

# RBAC, ABAC & Authorization Patterns

> **Interview weight:** 🔥🔥🔥 — Authorization design, IDOR prevention, and password hashing are staple interview topics.
> **Node version:** All examples target Node 22+ with ESM. Uses `argon2` and `casl` libraries.
> **Prereqs:** [Session Management](./03-sessions) · [JWT Tokens](./01-jwt-tokens) · [NestJS Request Lifecycle](/frameworks/nestjs/)

## 🗣️ In Plain English

::: tip In Plain English
Authentication asks "who are you?" — it checks your ID at the door. **Authorization** asks "what are you allowed to do?" — once you're inside the building, which rooms can you enter?

The simplest model is **RBAC** — Role-Based Access Control. Think of a hospital. A **doctor** can view patient records, order tests, and prescribe medications. A **nurse** can view records and administer medications, but not prescribe them. A **receptionist** can view appointment schedules but not medical records. Each person has a **role**, and each role comes with a set of **permissions**. You don't decide what Dr. Smith can do — you decide what **doctors** can do, and then assign Dr. Smith the doctor role.

RBAC works beautifully until it doesn't. Consider: "Dr. Smith can view patient records, but only for patients in her department, and only during her shift." Now the permission depends on **attributes** — the doctor's department, the patient's department, the current time. This is **ABAC** — Attribute-Based Access Control. Instead of static role-permission mappings, you write **policies** that evaluate attributes of the user, the resource, and the context at decision time.

The most common mistake in authorization isn't choosing the wrong model — it's forgetting to check at all. Developers protect the endpoint (`/admin/users`) but forget to check whether user A is requesting user B's data at the object level. This is called **IDOR** — Insecure Direct Object Reference. You've seen it in the wild: change `?userId=42` to `?userId=43` in the URL, and suddenly you're looking at someone else's account. The route-level guard said "you're logged in," but no one checked "is this your data?"

Finally, there's a piece of authorization that happens before the user even reaches your API: **password hashing**. When a user creates an account, you don't store their password — you store a one-way mathematical fingerprint of it. When they log in, you hash what they typed and compare fingerprints. If an attacker steals your database, they get fingerprints, not passwords. The key is using a **slow** hash (argon2, bcrypt) — slow enough that trying billions of guesses takes years, not hours.
:::

## ⚙️ Under the Hood

### Authentication vs Authorization

```
┌──────────────────────────────────────────────────────┐
│ REQUEST FLOW                                         │
│                                                      │
│ Client ──> Authentication Middleware ──> Authorization│
│            "Who is this?"              "Can they do   │
│            JWT verify / session        this action on │
│            lookup                      this resource?"│
│            │                           │              │
│            ▼                           ▼              │
│            401 Unauthorized            403 Forbidden  │
│            (unknown identity)          (known but     │
│                                        not allowed)   │
└──────────────────────────────────────────────────────┘
```

The HTTP status codes encode this distinction: **401** means "I don't know who you are" (missing or invalid credentials). **403** means "I know who you are, and you're not allowed."

### RBAC: Roles and Permissions

```typescript
// run: npx tsx rbac.ts

// ── Define the permission model ──
type Permission =
  | 'users:read'
  | 'users:write'
  | 'users:delete'
  | 'posts:read'
  | 'posts:write'
  | 'posts:delete'
  | 'admin:access';

type Role = 'viewer' | 'editor' | 'admin' | 'super_admin';

// Role → Permissions mapping
const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  viewer: new Set(['posts:read']),
  editor: new Set(['posts:read', 'posts:write', 'users:read']),
  admin: new Set(['posts:read', 'posts:write', 'posts:delete', 'users:read', 'users:write', 'admin:access']),
  super_admin: new Set([
    'posts:read', 'posts:write', 'posts:delete',
    'users:read', 'users:write', 'users:delete',
    'admin:access',
  ]),
};

// ── Role hierarchy (optional) ──
// super_admin inherits all admin permissions, admin inherits editor, etc.
const ROLE_HIERARCHY: Record<Role, Role[]> = {
  viewer: [],
  editor: ['viewer'],
  admin: ['editor', 'viewer'],
  super_admin: ['admin', 'editor', 'viewer'],
};

function getEffectivePermissions(role: Role): Set<Permission> {
  const permissions = new Set(ROLE_PERMISSIONS[role]);
  for (const parentRole of ROLE_HIERARCHY[role]) {
    for (const perm of ROLE_PERMISSIONS[parentRole]) {
      permissions.add(perm);
    }
  }
  return permissions;
}

// ── Authorization check ──
function hasPermission(userRole: Role, requiredPermission: Permission): boolean {
  return getEffectivePermissions(userRole).has(requiredPermission);
}

// Tests
console.log('viewer can read posts:', hasPermission('viewer', 'posts:read'));       // true
console.log('viewer can write posts:', hasPermission('viewer', 'posts:write'));     // false
console.log('editor can read users:', hasPermission('editor', 'users:read'));       // true
console.log('admin can delete users:', hasPermission('admin', 'users:delete'));     // false
console.log('super_admin can delete users:', hasPermission('super_admin', 'users:delete')); // true
```

### RBAC Middleware for Express

```typescript
// run: npx tsx rbac-middleware.ts
// Requires: npm install express @types/express jose

import express from 'express';
import type { Request, Response, NextFunction } from 'express';

// Extend Express Request to carry the authenticated user
interface AuthenticatedRequest extends Request {
  user?: {
    sub: string;
    role: string;
    permissions: string[];
  };
}

// Middleware: require specific permission
function requirePermission(...requiredPermissions: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const hasAll = requiredPermissions.every(
      (perm) => req.user!.permissions.includes(perm),
    );

    if (!hasAll) {
      // Log the denied attempt (important for security auditing)
      console.warn(`Authorization denied: user=${req.user.sub} ` +
        `required=${requiredPermissions.join(',')} ` +
        `has=${req.user.permissions.join(',')}`);
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

// Middleware: require one of several roles
function requireRole(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient role' });
      return;
    }

    next();
  };
}

const app = express();

// Simulated auth middleware (in production: JWT verify or session lookup)
app.use((req: AuthenticatedRequest, _res, next) => {
  req.user = {
    sub: 'user_42',
    role: 'editor',
    permissions: ['posts:read', 'posts:write', 'users:read'],
  };
  next();
});

// Protected routes
app.get('/api/posts', requirePermission('posts:read'), (_req, res) => {
  res.json({ posts: [] });
});

app.delete('/api/posts/:id', requirePermission('posts:delete'), (_req, res) => {
  res.json({ deleted: true }); // editor will get 403
});

app.get('/api/admin/dashboard', requireRole('admin', 'super_admin'), (_req, res) => {
  res.json({ stats: {} }); // editor will get 403
});

app.listen(3600, () => console.log('http://localhost:3600'));
```

### NestJS Guards and Decorators

```typescript
// NestJS approach using custom decorators and guards
// File: permissions.guard.ts

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// Custom decorator to annotate controller methods with required permissions
export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Read the permissions metadata set by @RequirePermissions()
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no permissions required, allow access
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) return false;

    return requiredPermissions.every(
      (perm) => user.permissions?.includes(perm),
    );
  }
}

// Usage in a controller:
// @Controller('posts')
// @UseGuards(AuthGuard, PermissionsGuard)
// export class PostsController {
//   @Get()
//   @RequirePermissions('posts:read')
//   findAll() { ... }
//
//   @Delete(':id')
//   @RequirePermissions('posts:delete')
//   remove(@Param('id') id: string) { ... }
// }
```

### ABAC: Attribute-Based Access Control

When RBAC isn't granular enough — multi-tenant apps, resource ownership, time-based access:

```typescript
// run: npx tsx abac.ts

interface User {
  id: string;
  role: string;
  department: string;
  orgId: string;
}

interface Resource {
  id: string;
  ownerId: string;
  department: string;
  orgId: string;
  status: 'draft' | 'published' | 'archived';
}

interface Context {
  action: 'read' | 'write' | 'delete';
  timestamp: Date;
}

// Policy: a function that evaluates user, resource, and context attributes
type Policy = (user: User, resource: Resource, context: Context) => boolean;

const policies: Record<string, Policy> = {
  // Users can only access resources in their own organization
  'same-org': (user, resource) =>
    user.orgId === resource.orgId,

  // Users can only edit their own resources (or admins can edit any)
  'owner-or-admin': (user, resource, context) => {
    if (context.action === 'read') return true;
    return user.id === resource.ownerId || user.role === 'admin';
  },

  // Department isolation: users see only their department's resources
  'same-department': (user, resource) =>
    user.department === resource.department || user.role === 'admin',

  // Time-based: no deletions outside business hours
  'business-hours-only-delete': (_user, _resource, context) => {
    if (context.action !== 'delete') return true;
    const hour = context.timestamp.getHours();
    return hour >= 9 && hour < 17;
  },
};

function evaluate(
  user: User,
  resource: Resource,
  context: Context,
  policyNames: string[],
): { allowed: boolean; deniedBy?: string } {
  for (const name of policyNames) {
    const policy = policies[name];
    if (policy && !policy(user, resource, context)) {
      return { allowed: false, deniedBy: name };
    }
  }
  return { allowed: true };
}

// Test
const user: User = { id: 'u1', role: 'editor', department: 'eng', orgId: 'org1' };
const resource: Resource = {
  id: 'r1', ownerId: 'u2', department: 'eng', orgId: 'org1', status: 'published',
};
const context: Context = { action: 'write', timestamp: new Date() };

const result = evaluate(user, resource, context, [
  'same-org',
  'owner-or-admin',
  'same-department',
]);

console.log(result);
// { allowed: false, deniedBy: 'owner-or-admin' }
// u1 is not the owner (u2 is) and u1 is not admin
```

### CASL.js: Declarative Authorization for Node.js

```typescript
// run: npx tsx casl-demo.ts
// Requires: npm install @casl/ability

import { AbilityBuilder, createMongoAbility, ForcedSubject } from '@casl/ability';

type Actions = 'read' | 'create' | 'update' | 'delete' | 'manage';
type Subjects = 'Post' | 'User' | 'Comment' | 'all';

interface UserContext {
  id: string;
  role: 'viewer' | 'editor' | 'admin';
  orgId: string;
}

function defineAbilitiesFor(user: UserContext) {
  const { can, cannot, build } = new AbilityBuilder(createMongoAbility);

  switch (user.role) {
    case 'admin':
      // Admin can manage everything in their org
      can('manage', 'all');
      // But cannot delete other admins (safety net)
      cannot('delete', 'User', { role: 'admin' });
      break;

    case 'editor':
      can('read', 'Post');
      can('create', 'Post');
      // Editors can only update/delete their OWN posts
      can(['update', 'delete'], 'Post', { authorId: user.id });
      can('read', 'Comment');
      can('create', 'Comment');
      can('delete', 'Comment', { authorId: user.id });
      break;

    case 'viewer':
      can('read', ['Post', 'Comment']);
      break;
  }

  return build();
}

// Usage
const editorAbility = defineAbilitiesFor({
  id: 'user_42',
  role: 'editor',
  orgId: 'org_1',
});

console.log('Can read Post?', editorAbility.can('read', 'Post'));          // true
console.log('Can create Post?', editorAbility.can('create', 'Post'));      // true
console.log('Can delete own Post?', editorAbility.can('delete', 'Post'));  // true (checked at query level)

// Field-level: CASL can also restrict which fields are accessible
// useful for GraphQL resolvers that need field-level authorization
```

### IDOR: Insecure Direct Object Reference

The most common authorization bug in web applications:

```typescript
// run: npx tsx idor.ts
// Requires: npm install express @types/express

import express from 'express';
import type { Request, Response } from 'express';

const app = express();

// Simulated database
const orders = [
  { id: 'order_1', userId: 'user_42', amount: 99.99, item: 'Widget' },
  { id: 'order_2', userId: 'user_43', amount: 149.99, item: 'Gadget' },
  { id: 'order_3', userId: 'user_42', amount: 29.99, item: 'Doodad' },
];

// ── VULNERABLE: No ownership check ──
app.get('/api/v1/orders/:id', (req: Request, res: Response) => {
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  // BUG: user_42 can access user_43's order by guessing the ID
  res.json(order);
});

// ── FIXED: Ownership check ──
app.get('/api/v2/orders/:id', (req: Request, res: Response) => {
  const userId = (req as Record<string, unknown>).user?.sub ?? 'user_42'; // from auth middleware
  const order = orders.find((o) => o.id === req.params.id);

  if (!order) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  // Check ownership — return 404 (not 403) to avoid leaking existence
  if (order.userId !== userId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.json(order);
});

// ── BEST: Query by user from the start ──
app.get('/api/v3/orders', (req: Request, res: Response) => {
  const userId = 'user_42'; // from auth middleware
  // Filter at the database query level — never load data the user can't see
  const userOrders = orders.filter((o) => o.userId === userId);
  res.json(userOrders);
});

app.listen(3700, () => console.log('http://localhost:3700'));
```

Key IDOR prevention rules:
1. **Return 404, not 403** for resources the user can't access — 403 leaks that the resource exists.
2. **Filter at the query level**, not after loading — add `WHERE userId = ?` to your SQL, not a post-load check.
3. **Use UUIDs, not sequential integers** for resource IDs — makes enumeration harder (but don't rely on this as a security measure).

### Authorization in GraphQL

```typescript
// GraphQL authorization happens at multiple levels:
// 1. Operation level — can this user run mutations at all?
// 2. Resolver level — can this user access this type/field?
// 3. Field level — filter sensitive fields from the response

// Using a middleware/directive approach:
const typeDefs = `
  type Query {
    posts: [Post!]!
    users: [User!]! @requireRole(role: "admin")
  }

  type User {
    id: ID!
    email: String! @requireRole(role: "admin")
    name: String!
    posts: [Post!]!
  }

  type Post {
    id: ID!
    title: String!
    content: String!
    author: User!
  }

  directive @requireRole(role: String!) on FIELD_DEFINITION
`;

// In the resolver, check ownership for mutations:
// Mutation: {
//   deletePost: async (_, { id }, context) => {
//     const post = await db.posts.findById(id);
//     if (!post) throw new GraphQLError('Not found', { extensions: { code: 'NOT_FOUND' } });
//
//     // Authorization check
//     if (post.authorId !== context.user.id && context.user.role !== 'admin') {
//       throw new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } });
//     }
//
//     return db.posts.delete(id);
//   }
// }
```

### Password Hashing: bcrypt vs argon2

```typescript
// run: npx tsx password-hashing.ts
// Requires: npm install argon2

import argon2 from 'argon2';
import { timingSafeEqual } from 'node:crypto';

// ── Why argon2id is preferred over bcrypt ──
// bcrypt:
//   - CPU-hard only (GPU-parallelizable)
//   - 72-byte password limit (silently truncates)
//   - Well-tested, widely deployed since 1999
//
// argon2id:
//   - CPU-hard AND memory-hard (resists GPU/ASIC attacks)
//   - Won the Password Hashing Competition (2015)
//   - Configurable memory, time, and parallelism
//   - No password length limit
//   - "id" variant combines resistance to both side-channel and GPU attacks

// ── Hashing a password ──
async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,  // argon2id = recommended variant
    memoryCost: 65536,      // 64 MB (OWASP minimum recommendation)
    timeCost: 3,            // 3 iterations
    parallelism: 4,         // 4 threads
    // salt is auto-generated (16 bytes) and embedded in the hash string
  });
}

// ── Verifying a password ──
async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    // argon2.verify is timing-safe internally
    return await argon2.verify(hash, password);
  } catch {
    // Invalid hash format, corrupted data, etc.
    return false;
  }
}

// ── Demo ──
const hash = await hashPassword('correct-horse-battery-staple');
console.log('Hash:', hash);
// $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>

console.log('Correct password:', await verifyPassword(hash, 'correct-horse-battery-staple')); // true
console.log('Wrong password:', await verifyPassword(hash, 'wrong-password'));                  // false

// ── Rehashing: upgrade parameters over time ──
async function verifyAndRehashIfNeeded(
  storedHash: string,
  password: string,
): Promise<{ valid: boolean; newHash?: string }> {
  const valid = await argon2.verify(storedHash, password);
  if (!valid) return { valid: false };

  // Check if the hash needs upgrading (e.g., memory cost was increased)
  if (argon2.needsRehash(storedHash, { memoryCost: 65536, timeCost: 3 })) {
    const newHash = await hashPassword(password);
    return { valid: true, newHash }; // caller updates the database
  }

  return { valid: true };
}
```

### Timing-Safe Comparison

```typescript
// run: npx tsx timing-safe.ts
import { timingSafeEqual, createHmac } from 'node:crypto';

// ── Why timing-safe comparison matters ──
// A naive string comparison (===) short-circuits: it returns false
// as soon as it finds the first different character.
// An attacker can measure response times to guess characters one by one.

// WRONG: vulnerable to timing attack
function unsafeCompare(a: string, b: string): boolean {
  return a === b; // short-circuits on first mismatch
}

// RIGHT: constant-time comparison
function safeCompare(a: string, b: string): boolean {
  // timingSafeEqual requires equal-length buffers
  // Use HMAC to normalize to fixed-length hashes
  const key = Buffer.from('comparison-key');
  const hmacA = createHmac('sha256', key).update(a).digest();
  const hmacB = createHmac('sha256', key).update(b).digest();
  return timingSafeEqual(hmacA, hmacB);
}

// This matters for: API key comparison, CSRF token validation,
// webhook signature verification — anywhere an attacker controls
// one side of the comparison and can measure response time.

console.log('Safe compare (equal):', safeCompare('secret123', 'secret123'));     // true
console.log('Safe compare (different):', safeCompare('secret123', 'secret456')); // false
```

### The "Authorization as Data" Pattern

Store permissions in a database table rather than hardcoding in middleware:

```sql
-- Permissions table
CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role        VARCHAR(50) NOT NULL,
  resource    VARCHAR(100) NOT NULL,  -- 'posts', 'users', 'orders'
  action      VARCHAR(50) NOT NULL,   -- 'read', 'write', 'delete'
  conditions  JSONB,                  -- ABAC conditions: {"own_only": true}
  UNIQUE(role, resource, action)
);

-- Example data
INSERT INTO permissions (role, resource, action, conditions) VALUES
  ('viewer', 'posts', 'read', NULL),
  ('editor', 'posts', 'read', NULL),
  ('editor', 'posts', 'write', '{"own_only": true}'),
  ('admin', 'posts', 'read', NULL),
  ('admin', 'posts', 'write', NULL),
  ('admin', 'posts', 'delete', NULL),
  ('admin', 'users', 'read', NULL),
  ('admin', 'users', 'write', NULL);
```

Benefits:
- Change permissions without redeploying code
- Audit trail of permission changes
- Per-tenant customization in multi-tenant apps
- Non-engineers (product managers) can manage permissions via an admin UI

Cost: database query on every authorization check (cache aggressively with short TTLs).

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. IDOR in multi-tenant SaaS.** Your API returns order details by ID: `GET /api/orders/order_123`. The auth middleware checks the JWT and confirms the user is authenticated. But no one checks whether `order_123` belongs to the user's organization. A customer from Org A can read Org B's orders by guessing IDs. This is the single most common authorization vulnerability in web applications. Fix: every database query must include the tenant/org filter: `WHERE id = ? AND orgId = ?`.

**2. Horizontal privilege escalation via role caching.** You cache the user's role in the JWT or session at login time. An admin demotes a user from "admin" to "viewer." The user's existing JWT still says `role: "admin"` for up to 15 minutes (access token lifetime). During that window, they have full admin access. For sensitive operations, re-check the role from the database — don't trust cached claims for high-privilege actions.

**3. bcrypt's 72-byte limit silently truncating passwords.** A user sets a 100-character passphrase. bcrypt silently hashes only the first 72 bytes. The user can log in with just the first 72 characters. Worse: two different passphrases that share the first 72 bytes produce the same hash. Use argon2id, which has no length limit, or pre-hash with SHA-256 before bcrypt (but this adds complexity).

**4. Missing rate limiting on login endpoints.** Your login endpoint hashes the password with argon2 on every attempt. An attacker sends 1000 login requests per second. Each argon2 hash consumes 64 MB of memory and significant CPU time. With 1000 concurrent requests, that's 64 GB of memory. The server OOMs. Fix: rate-limit login endpoints aggressively (e.g., 5 attempts per minute per IP/account) before reaching the password hash step.
:::

## 🎯 Checkpoint

::: details Question 1 — RBAC limitations
**Q:** You're building a document management system for a hospital. Doctors should only see patient records from their own department, nurses should see records only for patients they're assigned to, and administrators should see everything. Can you model this with pure RBAC? If not, what do you add?

**A:** Pure RBAC cannot express this. RBAC maps roles to permissions statically: "doctors can read patient records." But the requirement is conditional: "doctors can read patient records **in their department**." The permission depends on a relationship between the user's attributes (department) and the resource's attributes (patient's department).

You need ABAC or a hybrid RBAC+ABAC model. The roles (doctor, nurse, admin) still exist, but each role's permissions carry **conditions** evaluated at runtime:

- Doctor: `can('read', 'PatientRecord', { department: user.department })` — the resource's department must match the user's.
- Nurse: `can('read', 'PatientRecord', { assignedNurseId: user.id })` — the nurse must be in the patient's care team.
- Admin: `can('read', 'PatientRecord')` — no conditions.

In CASL.js, this looks like: `can('read', 'PatientRecord', { department: user.department })`. In SQL, it means every query includes `WHERE department = ?`. The role determines which policy template to apply; the attributes determine the runtime filtering.
:::

::: details Question 2 — IDOR prevention
**Q:** Your API endpoint `GET /api/users/:id/billing` is protected by a JWT auth middleware. A penetration test reveals that any authenticated user can access any other user's billing data by changing the `:id` parameter. The auth middleware correctly validates the JWT. Where is the bug, and how do you fix it systematically?

**A:** The bug is a missing **ownership check**. The auth middleware verifies identity ("this is user_42") but doesn't verify authorization ("is user_42 allowed to access this specific billing record?"). The endpoint trusts the `:id` URL parameter without comparing it to the authenticated user's identity.

Immediate fix: compare `req.params.id` to `req.user.sub` (from the JWT). If they don't match and the user isn't an admin, return 404 (not 403, to avoid leaking existence).

Systematic fix: (1) Create a middleware or decorator that automatically scopes queries to the authenticated user. In Express: `req.params.id = req.user.sub` for user-scoped endpoints, overriding whatever the client sent. (2) Use parameterized database queries that always include the user/org ID: `SELECT * FROM billing WHERE user_id = $1 AND id = $2` where `$1` comes from the JWT, not the URL. (3) Add automated IDOR testing to your CI pipeline — tools like OWASP ZAP can detect this class of bug. (4) Review all endpoints that accept resource IDs in the URL — IDOR is never an isolated bug; if one endpoint is vulnerable, others likely are too.
:::

::: details Question 3 — Password hashing parameters
**Q:** Your security team mandates upgrading from bcrypt (cost factor 12) to argon2id. How do you migrate existing users without forcing everyone to reset their passwords? What parameters do you choose for argon2id and why?

**A:** You **cannot re-hash** existing bcrypt hashes into argon2id because hashing is one-way — you don't have the original passwords. Instead, use a **lazy migration** strategy:

1. Add an `algorithm` column to the users table (or detect from the hash prefix: `$2b$` = bcrypt, `$argon2id$` = argon2id).
2. On login, verify against the stored hash using the original algorithm.
3. If verification succeeds **and** the hash is still bcrypt, re-hash the plaintext password with argon2id and update the database.
4. Over time, active users migrate naturally. For inactive users, you can force a password reset after a grace period (e.g., 90 days).

For argon2id parameters, follow the OWASP 2024 recommendations:
- `memoryCost: 65536` (64 MB) — minimum. Higher is better if your server has the RAM. Each login attempt allocates this much memory, so factor in concurrent logins.
- `timeCost: 3` — number of iterations. Increase if hashing completes in under 500ms on your hardware.
- `parallelism: 4` — number of threads. Match to available cores, but consider that concurrent requests compete for the same cores.

The target: hashing should take **500ms-1000ms** on your production hardware. Faster means attackers can brute-force faster. Slower means legitimate logins feel sluggish and your server handles fewer concurrent logins. Benchmark on your actual hardware and tune accordingly.
:::

## Key Mental Models

- **Authentication is the lock on the front door; authorization is the key card system inside.** They're separate concerns. A valid JWT proves identity; it says nothing about what the user is allowed to do.
- **RBAC is a lookup table; ABAC is a policy engine.** RBAC works when permissions are static per role. ABAC is needed when permissions depend on relationships between users, resources, and context.
- **IDOR is the most common and most dangerous authorization bug.** Always verify ownership at the data layer, not just at the route layer. Query by user ID, don't filter after loading.
- **Slow hashing is a feature, not a bug.** Password hashes should take 500ms+ to compute. This is your defense against offline brute-force attacks. But rate-limit the endpoint to prevent DoS via hash computation.
- **Return 404 for unauthorized resource access, not 403.** A 403 tells the attacker the resource exists. A 404 reveals nothing.

## Related

- [Session Management & Cookies](./03-sessions) — where the authenticated user's identity is stored
- [JWT: Access Tokens, Refresh Tokens & Rotation](./01-jwt-tokens) — the token carrying the user's role
- [NestJS Request Lifecycle](/frameworks/nestjs/) — guards, interceptors, and the DI container for auth
- [Security & Hardening](/nodejs/module-08/) — the broader threat model that authorization fits into
