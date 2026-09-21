# pdf-converter

Document-to-PDF conversion at ~1M documents/day. Mongo holds the source documents,
MySQL owns the job state machine, SQS carries the work, Chromium renders, S3 stores.

```bash
npm ci
npm run lint && npm run typecheck && npm test && npm run build
```

All four pass on a clean checkout. No database, AWS account or Chromium needed — the
tests mock every external dependency.

## How it flows

```
EventBridge / API / S3 drop
        │
   Dispatcher ── claims 1,000 rows at a time (UPDATE then SELECT)
        │         sends to SQS in batches of 10
        ▼
   SQS (batch | urgent)
        │
    Worker ── fetch Mongo doc → compile template → Chromium → S3
        │
   conversion_jobs.status = done
```

## What's implemented

| Piece | Path | Notes |
|---|---|---|
| Job state machine | `src/jobs/` | Atomic claim, lease reaper, batch progress |
| Dispatcher | `src/dispatcher/` | Chunked fan-out, backpressure, priority routing |
| Renderer | `src/render/` | Browser reuse + recycling, behind a port |
| Template cache | `src/templates/` | Compiled, keyed by id + version, single-flight |
| Storage | `src/storage/` | Default bucket or customer cross-account, with fallback |
| Worker | `src/worker/` | Orchestration, permanent vs retryable failures |
| Migration | `src/migrations/` | `conversion_jobs` table with its three indexes |

## What's deliberately left open

**Compute target.** The render path depends on `BrowserPort`, not on Playwright
directly, so Lambda (container image) and ECS differ only in the factory
implementation and the entrypoint. Pick after measuring real render times.

**Entrypoints.** There is no `main.ts` yet, because its shape depends on the compute
choice — a Lambda handler and a long-running poller are different. The services are
the reusable part.

**Org destination lookup.** `OrgConfigService` is a stub returning the default bucket.
Back it with your config table.

**Word → HTML onboarding.** A separate service. Deliberately not in this repo, so
LibreOffice never ends up in the render path.

## Configuration

Copy `.env.example`. The tuning knobs that matter:

| Variable | Default | Why you'd change it |
|---|---|---|
| `CLAIM_CHUNK_SIZE` | 1000 | Bounds dispatcher memory |
| `LEASE_MINUTES` | 15 | Must exceed your worst render time |
| `MAX_ATTEMPTS` | 3 | Retries before a job fails permanently |
| `BROWSER_RECYCLE_AFTER` | 200 | Lower if you see memory growth |
| `RENDER_TIMEOUT_MS` | 30000 | Raise for large documents |

## CLAUDE.md

`CLAUDE.md` holds the conventions and the decisions that are expensive to get wrong —
idempotency, claim ordering, backpressure, the failure split. The AI agent reads it
before every ticket. Keep it accurate.
