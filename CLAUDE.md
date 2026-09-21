# CLAUDE.md

<!--
This file is the single biggest lever on output quality. The agent reads it before
every run. Replace the NestJS examples below with your repo's real conventions, and
delete anything that does not apply. Keep it under ~150 lines; a long file gets
skimmed.
-->

## What this service is

One paragraph: what it does, who calls it, what it talks to (Mongo, MySQL, Redis,
SQS, third-party APIs).

## Commands

```bash
npm ci                 # install
npm run build          # tsc build
npm run lint           # eslint - must pass
npm run test           # unit tests - must pass
npm run test:e2e       # e2e - run when touching controllers/resolvers
npx tsc --noEmit       # typecheck
```

Always run lint, typecheck and unit tests before finishing.

## Layout

```
src/
  modules/<feature>/
    <feature>.module.ts
    <feature>.controller.ts     # REST
    <feature>.resolver.ts       # GraphQL
    <feature>.service.ts        # business logic lives here
    dto/                        # class-validator DTOs
    entities/ | schemas/
    <feature>.service.spec.ts
  common/                       # guards, interceptors, filters, decorators
  config/
```

## Conventions

- NestJS modules: one feature per module; providers exported explicitly.
- Business logic goes in services. Controllers and resolvers only validate, delegate
  and shape the response.
- All input DTOs use `class-validator`. No untyped `any` on a public boundary.
- Errors: throw Nest HTTP exceptions (`BadRequestException`, `NotFoundException`).
  Never return `null` to signal failure, never swallow an error.
- Async: no floating promises. Every `await` that can reject is handled or
  deliberately propagated.
- Config comes from `ConfigService`, never `process.env` directly in a service.
- Mongo: schemas in `entities/`, always index fields used in a query filter.
- SQS consumers: idempotent handlers - a message may be delivered more than once.
- Logging: Nest `Logger` with the class name as context. Never log secrets, tokens
  or PII.

## Testing

- Jest. Unit tests colocated as `*.spec.ts`.
- Mock external I/O (DB, SQS, HTTP); do not mock the unit under test.
- Every new service method needs: the happy path, one failure path, one edge case
  (empty input, not found, boundary value).
- A test must fail if the implementation is removed. No assertion-free tests.

## Never

- Never modify `.github/`, `.env*`, or anything under `infra/`.
- Never add a dependency unless the ticket asks for one.
- Never write a migration without saying so loudly in the PR body.
- Never change a GraphQL schema field's type or nullability without flagging it as a
  breaking change.
- Never weaken, skip or delete an existing test to get a green run.
