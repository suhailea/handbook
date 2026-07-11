---
title: "CI/CD Pipelines"
outline: deep
---

# CI/CD Pipelines

| Interview weight | Node version | Prerequisites |
|---|---|---|
| 🔥🔥 | Node 22+ | [Docker for Node.js](./01-docker), [node:test & Coverage](/nodejs/module-09/01-node-test) |

## 🗣️ In Plain English

::: tip In Plain English
Think of a factory assembly line for cars. Raw materials come in one end, and finished, tested, inspected cars come out the other. Nobody drives a car off the line and onto the highway without it passing through a quality check station, a paint booth, and an inspection bay -- in that exact order, every time.

CI/CD is the assembly line for software. CI (Continuous Integration) is the quality check: every time a developer pushes code, an automated system pulls the code, installs dependencies, runs the linter ("are the screws tight?"), runs the tests ("does the engine start?"), and builds the application ("does it fit together?"). If any step fails, the line stops, and the developer is notified before the bad code goes further.

CD (Continuous Deployment or Continuous Delivery) is the delivery truck. Once the code passes all checks, it is automatically packaged (built into a Docker image), shipped to a staging environment for a final look, and then delivered to production. The key word is "automatically" -- humans design the pipeline, but humans do not run the pipeline. Every push triggers the same sequence, the same checks, the same deployment steps.

Why does this matter? Because humans are inconsistent. A developer might forget to run the tests before pushing. Another might test on Node 20 while production runs Node 22. A third might deploy on Friday at 5 PM without noticing a failing test. The CI/CD pipeline does not forget, does not get tired, and does not skip steps. It is the same assembly line every single time.

The pipeline also gives you something invaluable: confidence. When the pipeline is green, you know the code compiles, the tests pass, the linter is happy, and the Docker image builds. You do not need to "hope" the deployment works -- the pipeline has already proven it.
:::

## ⚙️ Under the Hood

### GitHub Actions Workflow for Node.js

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

# Cancel in-progress runs for the same branch/PR
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'  # caches ~/.npm based on package-lock.json hash

      - run: npm ci

      - run: npm run lint
      - run: npm run typecheck  # tsc --noEmit

  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20, 22]
    # Run tests in parallel for each Node version
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - run: npm ci

      # Start services for integration tests
      - name: Start services
        run: docker compose -f docker-compose.test.yml up -d

      - name: Wait for services
        run: |
          until docker compose -f docker-compose.test.yml exec -T db pg_isready; do
            sleep 1
          done

      - name: Run tests with coverage
        run: npm test -- --coverage
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
          REDIS_URL: redis://localhost:6379

      - name: Check coverage threshold
        run: |
          # node:test outputs coverage to stdout; parse or use c8
          npx c8 check-coverage --lines 80 --branches 70 --functions 80

      - name: Stop services
        if: always()
        run: docker compose -f docker-compose.test.yml down

  build:
    runs-on: ubuntu-latest
    needs: [lint-and-typecheck, test]  # only runs if lint + test pass
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - run: npm ci
      - run: npm run build

      # Upload build artifacts for deployment job
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
          retention-days: 1
```

### Caching node_modules

The `actions/setup-node` cache option caches the npm cache directory (`~/.npm`), not `node_modules` itself. This means `npm ci` still runs but downloads packages from the local cache instead of the registry.

For faster builds, you can cache `node_modules` directly:

```yaml
      - name: Cache node_modules
        id: cache-modules
        uses: actions/cache@v4
        with:
          path: node_modules
          key: modules-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

      - name: Install dependencies
        if: steps.cache-modules.outputs.cache-hit != 'true'
        run: npm ci
```

**Trade-off:** Caching `node_modules` is faster (skips `npm ci` entirely) but riskier. If a dependency has a postinstall script that depends on the OS or Node version, the cached version may be incorrect. The npm cache approach (`cache: 'npm'`) is safer.

### Matrix Testing

```yaml
    strategy:
      matrix:
        node-version: [20, 22]
        os: [ubuntu-latest, macos-latest]
      fail-fast: false  # don't cancel other matrix jobs if one fails
```

This creates 4 jobs: Node 20 on Ubuntu, Node 22 on Ubuntu, Node 20 on macOS, Node 22 on macOS. Use `fail-fast: false` to see all failures, not just the first.

### Docker Build and Push in CI

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write  # for GitHub Container Registry

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:latest
            ghcr.io/${{ github.repository }}:${{ github.sha }}
          cache-from: type=gha   # GitHub Actions cache for Docker layers
          cache-to: type=gha,mode=max

      - name: Scan image for vulnerabilities
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ghcr.io/${{ github.repository }}:${{ github.sha }}
          severity: HIGH,CRITICAL
          exit-code: 1  # fail the build on critical vulns

  deploy-staging:
    needs: build-and-push
    runs-on: ubuntu-latest
    environment: staging  # GitHub environment with protection rules
    steps:
      - name: Deploy to staging
        run: |
          # Example: deploy to Railway
          # railway up --environment staging

          # Example: deploy to K8s
          # kubectl set image deployment/myapp \
          #   myapp=ghcr.io/${{ github.repository }}:${{ github.sha }}
          echo "Deployed ${{ github.sha }} to staging"

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production  # requires manual approval
    steps:
      - name: Deploy to production
        run: |
          echo "Deployed ${{ github.sha }} to production"
```

### Database Migrations in CI/CD

Migrations must run **before** the new code starts. The typical pattern:

```yaml
  deploy:
    steps:
      # 1. Run migrations against the target database
      - name: Run database migrations
        run: npx prisma migrate deploy  # or knex migrate:latest
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

      # 2. Deploy new code (which expects the new schema)
      - name: Deploy application
        run: echo "Deploy new version"
```

**Rollback strategy:** Migrations should be backward-compatible. The new schema should work with both the old and new code during the rolling deployment window. This means:

1. **Adding a column:** Add it as nullable or with a default. Deploy new code that writes to it. Later, make it non-nullable.
2. **Removing a column:** Deploy new code that stops reading it. Then remove the column in a later migration.
3. **Renaming a column:** Add the new column, deploy code that writes to both, backfill, deploy code that reads from the new one, drop the old column.

Never run destructive migrations (drop column, drop table) in the same deployment as the code change that removes the dependency.

### Preview Deployments (Per-PR)

```yaml
# .github/workflows/preview.yml
name: Preview

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Deploy to a preview environment (Vercel, Railway, Render, etc.)
      - name: Deploy preview
        id: deploy
        run: |
          # Vercel example — automatic per-branch previews
          npx vercel --token ${{ secrets.VERCEL_TOKEN }} \
            --yes \
            --env DATABASE_URL=${{ secrets.PREVIEW_DATABASE_URL }} \
            > deploy-url.txt
          echo "url=$(cat deploy-url.txt)" >> "$GITHUB_OUTPUT"

      - name: Comment PR with preview URL
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `Preview deployed: ${{ steps.deploy.outputs.url }}`
            });
```

### Secrets Management in CI

**Rules:**
1. Never commit secrets to code. Not even "temporarily."
2. Use GitHub Secrets (Settings > Secrets and variables > Actions).
3. Secrets are masked in logs -- GitHub replaces the value with `***`.
4. Use environments (staging, production) with different secrets per environment.
5. Require manual approval for production deployments.

```yaml
    environment: production  # loads secrets scoped to "production" environment
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL }}      # per-environment
      API_KEY: ${{ secrets.API_KEY }}                  # per-environment
```

### Branch Protection and Required Checks

Configure in GitHub Settings > Branches > Branch protection rules:

- **Require status checks to pass:** Select the CI jobs (lint, test, build) that must pass before merging.
- **Require pull request reviews:** At least one approval before merge.
- **Require branches to be up to date:** The PR branch must be rebased on the latest main.
- **Do not allow bypassing:** Even admins must follow the rules.

### Semantic Versioning and Automated Releases

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # full history for changelog generation

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - run: npm ci

      # Using changesets for version management
      - name: Create Release PR or Publish
        uses: changesets/action@v1
        with:
          publish: npm run release  # runs changeset publish
          title: 'chore: version packages'
          commit: 'chore: version packages'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Changesets workflow:**
1. Developer runs `npx changeset` locally, selects affected packages, writes a changelog entry.
2. The changeset file is committed with the PR.
3. When the PR merges to main, the GitHub Action creates a "Version Packages" PR that bumps versions and updates changelogs.
4. When that PR is merged, the action publishes the release and creates a GitHub Release.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Migrations run after code deploys.** Your new code expects a column `users.display_name`. The deployment pipeline deploys the new code first, then runs migrations. For 30 seconds during the rolling deployment, the new code queries a column that does not exist. Symptom: 500 errors with "column display_name does not exist." Fix: always run migrations before deploying new code. And make migrations backward-compatible: add the column in migration, deploy new code that uses it, then (optionally) make it required in a later migration.

**2. CI caches stale node_modules.** You cache `node_modules` keyed on `package-lock.json`. A developer updates a dependency that has a postinstall script generating platform-specific binaries. The lockfile changes, so the cache key changes, and `npm ci` runs fresh -- but only on the first run. Subsequent runs on the same lockfile use the cached `node_modules` from Ubuntu, which works fine... until someone runs the CI on a different runner OS (macOS) and gets a binary compiled for Linux. Symptom: intermittent "invalid ELF header" errors in CI. Fix: include `runner.os` and `node-version` in the cache key.

**3. Secrets leaked in CI logs.** A developer adds a debug step: `run: echo "Connecting to $DATABASE_URL"`. GitHub masks known secrets in logs, but if the secret is embedded in a longer string or processed through a command, it may appear in logs unmasked. Symptom: credentials visible in public CI logs. Fix: never echo secrets. Use `--quiet` flags. Audit CI logs after pipeline changes.

**4. No concurrency control on deployments.** Two PRs merge to main within 30 seconds. Both trigger deploy workflows. Both try to run migrations and deploy simultaneously. The second migration fails because the first is still running, or both deploy different versions concurrently. Symptom: deployment errors, inconsistent state. Fix: use the `concurrency` key in GitHub Actions to ensure only one deploy runs at a time: `concurrency: { group: deploy-production, cancel-in-progress: false }`.
:::

## 🎯 Checkpoint

::: details Question 1 — Pipeline design
**Q:** Design a CI/CD pipeline for a Node.js monorepo with three services (API, worker, admin dashboard). Each service has its own Dockerfile. What jobs would you create, and how would you optimize build times?

**A:** Jobs:

1. **Shared lint + typecheck** (runs once for the whole monorepo): `npm run lint`, `tsc --noEmit`. These apply to all services.
2. **Test per service** (3 parallel jobs): Each runs only the tests for its service. Use path filters (`paths: ['services/api/**']`) to skip services not changed in the PR.
3. **Build Docker images** (3 parallel jobs, depends on test): Each builds its service's Dockerfile. Use Docker layer caching (`cache-from: type=gha`). Tag with both `latest` and the commit SHA.
4. **Deploy to staging** (sequential, depends on all builds): Deploy all changed services. Run smoke tests.
5. **Deploy to production** (sequential, manual approval via GitHub environment): Deploy changed services with rolling updates.

Optimizations: (1) Use `actions/cache` for `node_modules` with a key including `runner.os`, `node-version`, and `hashFiles('package-lock.json')`. (2) Use path-based filtering (`on: push: paths:`) so that changing `services/api/` only triggers API tests and API Docker build, not all three. (3) Use Docker Buildx with `cache-from/cache-to` of type `gha` to cache Docker layers across runs. (4) Run lint, typecheck, and tests in parallel using separate jobs. (5) Use `concurrency` to prevent overlapping deployments.
:::

::: details Question 2 — Migration safety
**Q:** You need to rename a database column from `name` to `display_name` in a production system with rolling deployments. Describe the safe migration sequence.

**A:** This requires three deployments, not one:

**Deployment 1 (expand):** Add the `display_name` column (nullable). Deploy code that writes to BOTH `name` and `display_name` but reads from `name`. Backfill `display_name` from `name` for existing rows.

**Deployment 2 (migrate reads):** Deploy code that reads from `display_name` instead of `name`, still writes to both. Verify in production that `display_name` is populated for all rows and the application works correctly.

**Deployment 3 (contract):** Drop the `name` column (or rename it to `name_deprecated` with a future cleanup). Deploy code that only uses `display_name`.

This "expand-migrate-contract" pattern ensures that at every step, both the old and new code versions work with the current schema. During a rolling deployment, some pods run the old code and some run the new code -- both must be able to read and write correctly. A direct rename would break old pods that still reference `name`.
:::

## Key Mental Models

- **CI is a quality gate, not a suggestion.** If the pipeline is green, the code is known-good. If it is red, no amount of "it works on my machine" matters.
- **Layer caching is the single biggest CI speed optimization.** Copy package files before source code in Dockerfiles; cache `node_modules` in CI. Order matters.
- **Migrations before code, always.** The database schema must be compatible with both the old and new code during rolling deployments.
- **Secrets belong in the environment, not the codebase.** Use GitHub Secrets, environment-scoped variables, and never echo them.
- **Preview deployments shrink the feedback loop.** Reviewers see a running version of the PR, not just a diff.

## Related

- [Docker for Node.js](./01-docker) — the Dockerfile that CI builds and pushes
- [node:test & Coverage](/nodejs/module-09/01-node-test) — the test runner that CI invokes
- [Configuration & Secrets Management](./03-config-secrets) — how secrets flow from CI into the running application
- [Database Migrations](/nodejs/module-11/04-migrations) — the migration strategies that CI must execute safely
