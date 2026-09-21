# orders-service

NestJS service used as the worked example for the Jira → AI agent → PR pipeline.

**Stack:** TypeScript, NestJS 10, MySQL (TypeORM), MongoDB (Mongoose), SQS, S3.

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

All four pass on a clean checkout. No database is needed — unit tests mock all I/O.

## What's in it

| Area | Path | Purpose |
|---|---|---|
| Orders | `src/modules/orders/` | MySQL-backed order CRUD, idempotent `markPaid` |
| Audit | `src/modules/audit/` | Mongo append-only event log |
| Queue | `src/queue/` | SQS consumer for `order.paid` events |
| Storage | `src/storage/` | S3 presigned upload/download URLs |
| Health | `src/modules/health/` | `GET /health` |

## Endpoints

```
POST   /orders                          create an order
GET    /orders?merchantId=...           list a merchant's orders
GET    /orders/:id                      fetch one
POST   /orders/:id/receipt-upload-url   presigned PUT for a receipt
GET    /orders/:id/receipt-url          presigned GET for a receipt
GET    /health
```

## Running it for real

Copy `.env.example` to `.env` and fill it in. You need a MySQL database, a Mongo
instance, an SQS queue and an S3 bucket. None of these are needed to run the tests.

## CLAUDE.md

`CLAUDE.md` is what the AI agent reads before every ticket. It describes the
conventions this code actually follows. Keep it accurate — if the code and that file
disagree, the agent follows the file and produces a PR you have to reject.
