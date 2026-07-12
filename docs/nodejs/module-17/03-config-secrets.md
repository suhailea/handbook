---
title: Configuration & Secrets Management
outline: deep
---

# Configuration & Secrets Management

🔥🔥🔥 **Interview weight** | **Node 22+** | **Prereqs:** [Docker](./01-docker)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you're running a chain of restaurants. Each location needs the same recipes (code) but different details: the local supplier's phone number, the WiFi password, the health inspector's contact. You wouldn't print the WiFi password in the recipe book — it changes per location and it's sensitive.

Configuration is those per-location details. Some are harmless (which port to listen on), some are sensitive (database passwords, API keys). The 12-Factor App rule says: keep configuration outside your code, in the environment. Your code should work the same everywhere — what changes is the environment it runs in.

Secrets are the most sensitive configs. You wouldn't write the safe combination on a sticky note on the safe. Similarly, database passwords shouldn't be in your code, your Git history, or even in plain-text environment files in production. They should live in a vault — a dedicated system that encrypts them, controls access, and rotates them automatically.

The startup rule: validate all your configuration the moment your app starts. If the database URL is missing, crash immediately with a clear error. Don't discover it 3 hours later when the first request tries to connect.
:::

## ⚙️ Under the Hood

### The 12-Factor Config Rule

Configuration belongs in environment variables, not in code:

```typescript
// ❌ Bad — hardcoded
const DB_URL = 'postgres://user:pass@prod-db:5432/app';

// ✅ Good — from environment
const DB_URL = process.env.DATABASE_URL;
```

### Config Validation at Startup with Zod

Fail fast if config is missing or invalid:

```typescript
// run: DATABASE_URL=postgres://localhost/test node --experimental-strip-types config.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  CORS_ORIGINS: z.string().transform(s => s.split(',')).default('http://localhost:3000'),
});

// Parse and validate — throws on invalid config
export const config = envSchema.parse(process.env);

// TypeScript knows the exact shape:
// config.PORT is number, config.CORS_ORIGINS is string[], etc.
console.log(`Starting on :${config.PORT} in ${config.NODE_ENV} mode`);
```

### dotenv and Its Limitations

```typescript
// Development only — load .env file
import 'dotenv/config'; // Must be first import

// .env file (NEVER commit to git)
// DATABASE_URL=postgres://localhost/dev
// JWT_SECRET=dev-secret-at-least-32-chars-long
```

**Rules:**
- `.env` is for local development ONLY
- `.env` goes in `.gitignore` — never commit it
- `.env.example` (with placeholder values) IS committed as documentation
- Production uses real environment variables (K8s Secrets, cloud provider config)

### Secrets Management

| Approach | When to Use |
|----------|-------------|
| Environment variables | Simple deploys, Heroku, Railway |
| K8s Secrets | Kubernetes deployments (base64, not encrypted at rest by default) |
| AWS Secrets Manager | AWS infrastructure, auto-rotation, audit trail |
| HashiCorp Vault | Multi-cloud, dynamic secrets, fine-grained policies |
| Doppler / Infisical | Developer-friendly, syncs to any platform |

```typescript
// Fetching secrets from AWS Secrets Manager at startup
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

async function loadSecrets(): Promise<Record<string, string>> {
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const result = await client.send(
    new GetSecretValueCommand({ SecretId: 'my-app/production' })
  );
  return JSON.parse(result.SecretString!);
}

// Load secrets, merge with env, then validate
const secrets = await loadSecrets();
Object.assign(process.env, secrets);
const config = envSchema.parse(process.env);
```

### Feature Flags

```typescript
// Simple file-based feature flags
const features = {
  newCheckout: process.env.FF_NEW_CHECKOUT === 'true',
  betaApi: process.env.FF_BETA_API === 'true',
  maxUploadMB: parseInt(process.env.FF_MAX_UPLOAD_MB || '10'),
};

// Usage
if (features.newCheckout) {
  // new flow
}
```

For production, use a feature flag service (LaunchDarkly, Unleash, Flagsmith) that supports gradual rollouts, A/B testing, and per-user targeting.

### NestJS ConfigModule

```typescript
import { ConfigModule, ConfigService } from '@nestjs/config';
import { z } from 'zod';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => envSchema.parse(config),
    }),
  ],
})
export class AppModule {}

// Inject anywhere
@Injectable()
export class AppService {
  constructor(private config: ConfigService) {
    const port = this.config.get<number>('PORT');
  }
}
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
1. **Secrets in Git history:** Even if you delete a `.env` file, it's in the Git history forever. Use `git filter-branch` or BFG Repo-Cleaner to purge it. Rotate all exposed credentials immediately.

2. **Missing config discovered at runtime:** Without startup validation, a missing `REDIS_URL` only crashes when the first request needs Redis — potentially hours after deployment. Always validate at startup.

3. **Config drift between environments:** Staging works but production breaks because someone added a new env var to staging but forgot production. Keep a canonical `.env.example` and validate against it in CI.

4. **Secret rotation downtime:** Changing a database password requires restarting all pods. Use secrets managers with dynamic secrets (Vault generates short-lived DB credentials) or graceful credential refresh.
:::

## 🎯 Checkpoint

::: details Question 1 — Why not .env in production?
**Q:** Why should you not use `.env` files in production?

**A:** `.env` files are plaintext files on disk — anyone with server access can read them. They don't support rotation, auditing, or access control. In production, use proper secrets management (K8s Secrets, AWS Secrets Manager, Vault) which provide encryption at rest, access policies, audit trails, and rotation support. Environment variables set by the orchestrator (K8s, ECS) are better because they're not persisted to disk on the container filesystem.
:::

::: details Question 2 — Config validation timing
**Q:** When should configuration be validated and why?

**A:** At application startup, before any server starts listening or any connection is opened. The principle is "fail fast" — if a required environment variable is missing or malformed, the process should crash immediately with a clear error message naming the missing variable. Discovering a missing `DATABASE_URL` when the first request arrives (potentially hours later) means you've been running a broken deployment without knowing it. Zod schema validation with `.parse(process.env)` is the idiomatic approach in TypeScript.
:::

## Key Mental Models

- **Config in the environment, secrets in a vault.** Code should be identical across environments. Only configuration changes.
- **Validate at startup, crash on missing.** A clear error at boot is infinitely better than a mysterious failure at 3 AM.
- **`.env` is for development only.** Production uses the orchestrator's secret management. Never commit `.env` files.
- **Feature flags decouple deployment from release.** Deploy the code anytime; enable the feature when ready.

## Related

- [Docker for Node.js](./01-docker)
- [CI/CD Pipelines](./02-cicd)
- [Health Checks & Monitoring](./04-health-monitoring)
- [Error Doctrine](/nodejs/module-03/06-error-doctrine)
