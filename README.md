# Engineering Handbook

A personal backend engineering handbook — every concept explained twice: first in plain English, then with full technical depth.

Built with [VitePress](https://vitepress.dev/).

## Local Development

```bash
# Requirements: Node.js >= 22
npm install
npm run docs:dev
```

## Build

```bash
npm run docs:build
npm run docs:preview   # preview the production build
```

## Deployment

- **Primary:** Vercel (auto-deploys from `main`)
- **Fallback:** GitHub Pages via `.github/workflows/deploy.yml`

## Project Guide

See [CLAUDE.md](./CLAUDE.md) for the full content map, page template, and writing conventions.
