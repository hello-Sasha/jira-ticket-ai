# CLAUDE.md

Conventions for the PDF converter. Read this before making any change.

## What this service is

High-volume document-to-PDF conversion, targeting ~1M documents/day.

- **MySQL** holds `conversion_jobs` — one row per document, owning the state machine.
- **MongoDB** holds the source documents. The worker fetches its own payload.
- **SQS** carries one message per document. Two queues: batch and urgent.
- **S3** holds HTML templates and the rendered PDFs.
- **Chromium** (Playwright) renders HTML to PDF.

Word templates are converted to HTML **once, at onboarding**, by a separate service.
LibreOffice must never appear in the per-document render path — that decision is what
makes the cost model work.

## Commands

```bash
npm ci
npm run lint          # must pass with zero errors
npm run typecheck     # tsc --noEmit
npm test              # jest
npm run build         # nest build
```

All four pass on a clean checkout. Tests require no MySQL, Mongo, S3, SQS or real
Chromium — everything external is mocked or behind a port.

## Layout

```
src/
  config/configuration.ts      typed config; the only place process.env is read
  jobs/                        conversion_jobs entity + state transitions
  dispatcher/                  claim loop, SQS fan-out, deterministic output key
  render/
    browser.port.ts            the interface PdfRenderer depends on
    chromium.factory.ts        the real Playwright implementation
    pdf-renderer.service.ts    browser reuse, recycling, timeouts
  templates/                   compiled-template cache, keyed by id + version
  storage/                     S3 writer, default bucket or customer cross-account
  payload/                     Mongo document fetch
  worker/                      orchestration and the failure split
  migrations/
```

## The rules that matter

These encode decisions that are expensive to get wrong. Changing any of them needs a
reason stated in the PR.

**Idempotency comes from the output key.** `outputKey()` derives the S3 key from the
job: org, batch, job id, template version. SQS is at-least-once, so messages will be
redelivered; a deterministic key means the duplicate overwrites the same object.
Never generate a key from a timestamp, a UUID, or anything else created at render
time — that turns a retry into a duplicate document.

**Claim by UPDATE-then-SELECT, never SELECT-then-UPDATE.** `JobsService.claimBatch`
updates first and reads back what it claimed. The other order lets two dispatchers
claim the same rows. There is a test asserting the call order; do not relax it.

**The dispatcher holds one chunk at a time.** The claim loop awaits each chunk's
sends before claiming the next. That await is backpressure — removing it reintroduces
unbounded memory while looking like it still streams. The dispatcher moves ids only;
it must never load Mongo payloads.

**Reuse the browser, recycle on a counter.** Launching Chromium costs 1–3s, rendering
in a warm browser 200–500ms. `PdfRendererService` launches once and recycles every
`BROWSER_RECYCLE_AFTER` renders because Chromium leaks. A failed render discards the
browser — it may be wedged.

**Render depends on `BrowserPort`, not Playwright.** That is what keeps tests fast and
keeps the Lambda-vs-ECS choice open. New render code goes behind the port.

**Permanent vs retryable failures are different.** Throw `PermanentJobError` for
anything that will fail identically on retry — missing document, missing template,
malformed data. Everything else is retryable. Retrying a permanent failure burns three
renders to reach the same conclusion.

**Never delete an SQS message in an error path.** `WorkerService.handle` rethrows on
failure so the caller leaves the message on the queue to be retried and eventually
dead-lettered.

**A customer bucket failure falls back, it does not fail the job.** `DocumentStore`
writes to the default bucket and returns `degraded: true`. A customer's broken role
must never mean a lost document or an infinite retry.

**Batch completion is a query, not a counter.** `batchProgress()` counts rows. Do not
add a separate counter store — two mechanisms tracking one fact will drift.

## Testing

- Jest, specs colocated as `*.spec.ts`.
- Mock the repository via `getRepositoryToken`, the AWS clients via `{ send: jest.fn() }`,
  and the browser via a fake implementing `BrowserPort`.
- Every service method needs a happy path, a failure path and an edge case.
- A test must fail if the implementation is removed.
- Concurrency rules above need tests asserting the mechanism, not just the result.

## Never

- Never modify `.github/`, `.env*`, or CI config.
- Never set `synchronize: true`. Schema changes are migrations, flagged in the PR.
- Never read `process.env` outside `src/config/configuration.ts`.
- Never weaken, skip or delete a test to get a green run.
- Never log a presigned URL, customer credentials, or document contents.
- Never add LibreOffice or Word handling to the render path.
