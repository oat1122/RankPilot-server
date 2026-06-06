# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run start:dev          # run with watch (default port 3001, override via PORT)
npm run start:debug        # watch + --inspect
npm run build              # nest build → dist/
npm run start:prod         # node dist/main

npm run lint               # eslint --fix over {src,apps,libs,test}
npm run format             # prettier --write

npm test                   # jest unit tests (*.spec.ts under src/)
npm run test:watch
npm run test:cov
npm run test:e2e           # jest with test/jest-e2e.json (*.e2e-spec.ts under test/)
npx jest src/path/to/file.spec.ts   # run a single unit test file
```

Swagger UI is served at `/docs` once running; the OpenAPI JSON there is the contract used to generate a TypeScript client for the web frontend.

## Project status & context

This repo is a freshly-scaffolded NestJS API in **"setup phase."** Only the env/validation/logging/Swagger plumbing and a `/health` endpoint exist. `bullmq`, `ioredis`, and `@nestjs/axios` are installed but **not yet wired** — `DATABASE_URL`/`REDIS_URL` are intentionally optional in the env schema, reserved for Phase 1.

The git root is `server/` only. The parent `E:\RankPilot\` is the broader workspace containing `client/` (Next.js, currently empty) and **`docs/` — the design source of truth.** Code comments are in Thai and cite these docs as `เอกสาร NN §M` ("document NN section M"), mapping to `../docs/0N-*.md`:

- `00-overview-and-stack.md` — locked stack, pipeline, architecture rules
- `01-database-drizzle-mariadb.md` — Drizzle schema, MariaDB VECTOR
- `02-ai-advisor-langgraph.md` — LangGraph graphs/prompts
- `03-ahrefs-budget-service.md` — Ahrefs unit budgeting
- `04-monorepo-bootstrap.md` — target monorepo layout
- `05-deployment-shared-host.md` — deployment

**Consult these docs before adding a feature** — they dictate conventions that aren't yet visible in the (minimal) code.

### Where this is heading

This becomes `apps/api` in a planned npm-workspaces + Turborepo monorepo:
`apps/{api,worker,web}` + `packages/{db,shared,ai,config}`. RankPilot is an automated keyword/SEO analysis system; pipeline: Crawler → Ahrefs Enrichment → Analysis → AI Advisor → Dashboard.

## Architecture conventions

- **Zod is the single validation layer everywhere.** DTOs are `createZodDto` (`nestjs-zod`) classes, validated globally by `ZodValidationPipe` registered as `APP_PIPE` in `app.module.ts`. The same Zod schemas are intended to back env, DTOs, and LangGraph structured output. Do not introduce `class-validator`/DTO-by-decorator.
- **Env is validated fail-fast at boot.** Add any new env var to the Zod schema in `src/config/env.ts` (`validateEnv` runs via `ConfigModule.forRoot({ validate })`). Read values through `ConfigService`, never `process.env` directly.
- **One NestJS module per domain.** Follow the `health/` shape: `<domain>.module.ts` + `<domain>.controller.ts`, imported into `app.module.ts`.
- **Document every controller for Swagger** (`@ApiTags`, `@ApiResponse`, `addBearerAuth` already configured) — the generated client depends on it.
- **CORS uses Bearer JWT (Clerk), not cookies** (`credentials: false`, origin = `WEB_ORIGIN`). Auth is cross-domain via Authorization header.
- **API ≠ Worker (hard rule).** Long-running work — crawl, Ahrefs enrichment, AI — must never run in the request thread; it is queued to BullMQ for the separate `worker` app. Keep controllers/services thin and enqueue rather than execute heavy jobs here.
- **Central FE↔BE envelope (`src/common/http/`).** Every API response is wrapped by the global `ResponseInterceptor` into `{ success: true, data, meta }`, and every exception is normalized by the global `AllExceptionsFilter` into `{ success: false, error: { code, message, details? }, meta }` (`meta` = `{ timestamp, requestId, path? }`, `requestId` = pino's `req.id`). Both are registered once in `CommonModule` (imported by `AppModule` only — the worker has no HTTP layer). **Controllers still `return` raw resources** — do not hand-build envelopes. To raise errors, `throw new AppException(ErrorCode.X, msg, details?)` from the `ErrorCode` catalog (`error-codes.ts`) instead of raw `NotFoundException`/`HttpException`, so the FE gets a stable `error.code`. Document responses with `@ApiEnvelopeResponse(DataDto, …)` + `@ApiStandardErrorResponses()` (not bare `@ApiOkResponse`) so the generated TS client sees the real envelope shape. The envelope Zod schemas/types live in `api-response.schema.ts` and are intended to move to `packages/shared` for the `web` client to import.

## TypeScript / tooling notes

- `tsconfig` uses `module: nodenext`; `noImplicitAny` and `strictBindCallApply` are off, `strictNullChecks` on. ESLint runs `recommendedTypeChecked` — `no-floating-promises` and `no-unsafe-argument` are **warnings**, `no-explicit-any` is **off**.
- Jest `rootDir` is `src` for unit tests; e2e tests live in `test/` with their own `jest-e2e.json` and bootstrap the full `AppModule`.
