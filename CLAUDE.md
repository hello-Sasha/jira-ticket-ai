# CLAUDE.md

Conventions for this service. Read this before making any change.

## What this service is

`orders-service` — a NestJS REST API that owns merchant orders.

- **MySQL (TypeORM)** holds authoritative order state. Anything transactional or
  money-related lives here.
- **MongoDB (Mongoose)** holds the append-only audit event log. Never authoritative,
  never read inside a business decision.
- **SQS** delivers order lifecycle events (`order.paid`) from the payments service.
- **S3** stores merchant receipt documents. Documents are uploaded and downloaded via
  presigned URLs; file bytes never pass through this service.

## Commands

```bash
npm ci                 # install
npm run build          # nest build
npm run lint           # eslint - must pass with zero errors
npm run typecheck      # tsc --noEmit
npm test               # jest unit tests - must pass
npm run test:cov       # coverage
```

Run `npm run lint`, `npm run typecheck` and `npm test` before finishing any change.
All three pass on a clean checkout — if one fails, you broke it.

There is no database in the test environment. Unit tests mock the TypeORM repository,
the Mongoose model, the SQS client and the S3 client. Never write a unit test that
needs a live MySQL, Mongo, SQS or S3.

## Layout

```
src/
  config/configuration.ts          typed config, read via ConfigService
  modules/
    orders/                        MySQL - the core domain
      orders.controller.ts         HTTP only: validate, delegate, shape
      orders.service.ts            all business logic
      orders.service.spec.ts
      dto/                         class-validator DTOs
      entities/order.entity.ts     TypeORM entity
    audit/                         Mongo - append-only event log
      audit.service.ts
      schemas/audit-event.schema.ts
    health/
  queue/
    order-events.consumer.ts       SQS polling consumer
    queue.module.ts                provides SQSClient
  storage/
    s3.service.ts                  presigned URLs + put/delete
    storage.module.ts              provides S3Client
```

## Conventions

**General**
- Business logic goes in services. Controllers validate input, call one service
  method, and shape the response. No logic in controllers.
- All request bodies are `class-validator` DTOs. The global `ValidationPipe` runs with
  `whitelist` and `forbidNonWhitelisted`, so any field not on the DTO is rejected.
- Config is read through `ConfigService` with a typed key (`config.get<string>('s3.documentsBucket')`).
  Never touch `process.env` outside `src/config/configuration.ts`.
- Errors are Nest HTTP exceptions: `NotFoundException`, `ConflictException`,
  `BadRequestException`. Never return `null` to signal failure. Never catch an error
  just to make it go away — the one deliberate exception is `AuditService.record`,
  documented below.
- `@typescript-eslint/no-explicit-any` and `no-floating-promises` are errors, not
  warnings. Every promise is awaited or explicitly voided.
- Logging uses the Nest `Logger` with the class name as context. Never log receipts,
  presigned URLs, credentials or full order payloads.

**MySQL / TypeORM**
- Entities live in `modules/<feature>/entities/`. Index every column used in a `where`
  clause — see `Order.merchantId` and `Order.externalRef`.
- `synchronize` is `false`. A schema change needs a migration, and a migration must be
  called out loudly in the PR body.
- Money is stored in integer cents (`totalCents`), never a float.
- `externalRef` is the idempotency key for order creation. Creating an order with a
  duplicate `externalRef` is a `ConflictException`, not a second row.

**MongoDB / Mongoose**
- Mongo is for audit events only. Never move authoritative state into it, and never
  read from it to make a business decision.
- Schemas live in `modules/<feature>/schemas/` and use `@Schema({ timestamps: true })`.
- Every query that filters or sorts needs a matching index — see the compound
  `{ merchantId: 1, occurredAt: -1 }` index on `AuditEvent`.
- Always bound a `find`. `findRecentForMerchant` caps the limit at 200; follow that
  pattern rather than returning an unbounded collection.
- `AuditService.record` deliberately swallows and logs its errors. A failed audit write
  must never fail the operation being audited. Do not "fix" this by rethrowing, and do
  not copy this pattern anywhere else.

**SQS**
- Handlers must be idempotent. SQS is at-least-once, so the same message will arrive
  twice. `OrdersService.markPaid` returns the existing order unchanged when it is
  already paid — that is the pattern to follow.
- Delete a message only after the handler succeeds. On failure, leave it on the queue
  so it is retried and eventually dead-lettered. Never delete a message in a `catch`.
- One failing message must not stop the batch.

**S3**
- Large or binary payloads move by presigned URL, never through this service.
- Keys are namespaced `<type>/<merchantId>/<entityId>.<ext>` — never put a raw
  user-supplied string in a key.
- Verify the entity exists before signing a URL for it. Signing first and checking
  later leaks the existence of objects.
- Presigned URLs default to 15 minutes. Do not raise this without saying why.

## Testing

- Jest, unit tests colocated as `*.spec.ts` next to the code.
- Mock external I/O: the TypeORM repository via `getRepositoryToken`, the Mongoose
  model via `getModelToken`, and the `SQSClient` / `S3Client` via a plain
  `{ send: jest.fn() }`. Never mock the unit under test.
- Every service method needs: the happy path, one failure path, and one edge case
  (not found, empty result, duplicate, boundary value).
- A test must fail if the implementation is removed. No assertion-free tests.
- Follow the existing specs as templates — `orders.service.spec.ts` for repository
  mocking, `audit.service.spec.ts` for the Mongoose query-chain mock,
  `order-events.consumer.spec.ts` for SQS.

## Never

- Never modify `.github/`, `.claude/`, `.env*`, or CI configuration.
- Never add a dependency the ticket did not ask for.
- Never set `synchronize: true`.
- Never weaken, skip or delete an existing test to get a green run. If an existing
  test genuinely must change, change it and flag it prominently in the PR.
- Never delete an SQS message in an error path.
- Never log or persist a presigned URL.
- Never refactor, reformat or upgrade anything outside the ticket's scope.
