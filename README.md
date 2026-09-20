# FraudFirst

The incident-response layer for people who just got scammed.

Users start an incident, collect evidence, extract facts, correlate evidence, build a timeline, preserve evidence, get guided response, and receive a clean incident package. FraudFirst supplements — and never replaces — banks, the police, India's 1930 cyber-fraud helpline, and the National Cyber Crime Reporting Portal.

> Foundation build (v0.1.0). The full workflow, evidence system, and AWS services are added in later tasks.

## Tech Stack

- **Next.js 16** (App Router, React 19, Turbopack)
- **TypeScript**
- **Tailwind CSS v4**
- **shadcn/ui-style primitives** (Radix Slot, CVA, tailwind-merge, clsx)
- **Lucide** icons
- **Framer Motion** animations

## Local Setup

```bash
npm install
```

Copy the example environment file (optional in development):

```bash
copy .env.example .env.local
```

## Development

```bash
npm run dev
```

Open http://localhost:3000.

## Build

```bash
npm run build
```

## Lint

```bash
npm run lint
```

## Test

No test framework is configured yet.

## Health Check

Application status endpoint:

```bash
curl http://localhost:3000/api/health
```

## Project Structure

```
src/
  app/          routes, layouts, API route handlers
  components/   shared React components (ui primitives in components/ui)
  config/       site + environment configuration
  hooks/        shared React hooks
  lib/          utilities
  services/     service-layer abstractions (incidents, evidence, intelligence)
  types/        shared domain types
```

## AWS Services

Not yet integrated. The `services/` layer is designed so AWS-backed
implementations can replace the current in-memory placeholders without
changes to call sites.