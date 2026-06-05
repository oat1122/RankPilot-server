---
name: api-foundation
description: Use when creating, modifying, or reviewing any NestJS API building block in this RankPilot `server` repo — a controller (`src/<domain>/*.controller.ts`), domain module (`*.module.ts`), Zod DTO (`createZodDto`), an env var in `src/config/env.ts`, Swagger docs, or code that enqueues a BullMQ job. Triggers — "สร้าง endpoint ใหม่", "เพิ่ม controller", "เพิ่ม module", "เพิ่ม domain", "สร้าง DTO", "validate body", "Zod schema", "createZodDto", "เพิ่ม env var", "อ่าน config", "ConfigService", "Swagger", "@ApiTags", "document API", "enqueue job", "BullMQ", "queue งานหนัก", "auth guard", "Bearer", "thin controller", or when seeing `class-validator` decorators / direct `process.env` / heavy work (crawl, Ahrefs, AI, Playwright) running inside a request handler that should be queued instead. Skip for the separate `worker` app (BullMQ consumers/processors), Drizzle schema work (`packages/db`, เอกสาร 01), LangGraph graphs (`packages/ai`, เอกสาร 02), the Next.js `web` frontend, or docs-only edits.
---

# API Foundation — NestJS Controllers, Modules, DTOs, Env, Queueing

> **อ่านก่อนเสมอ:** `../../../CLAUDE.md` (conventions) และ `../../../../docs/00-overview-and-stack.md` §4 (กฎสถาปัตยกรรม) + `04-monorepo-bootstrap.md` §6 (Zod เดียว FE↔BE). โค้ดนี้คือ `apps/api` ในอนาคต — เขียนให้ย้ายเข้า monorepo ได้.

## หลักการสำคัญ (ทำไมถึงสำคัญ)

1. **Zod คือ validation layer เดียวทั้งแอป** — DTO เป็นคลาส `createZodDto(schema)` (`nestjs-zod`) ตรวจอัตโนมัติด้วย `ZodValidationPipe` ที่ลงทะเบียนเป็น `APP_PIPE` ใน `app.module.ts` แล้ว. schema ตัวเดียวกันตั้งใจใช้ทั้ง DTO + env + LangGraph structured output → **ห้ามนำ `class-validator` / DTO-by-decorator เข้ามา** (จะแตกเป็นสอง layer).
2. **1 NestJS module = 1 domain** — ตามรูป `health/`: `<domain>.module.ts` + `<domain>.controller.ts` (+ `.service.ts` ถ้ามี logic) แล้ว `import` เข้า `app.module.ts`. ถ้าไม่ register module → endpoint ไม่ถูก mount เงียบ ๆ.
3. **Env ตรวจ fail-fast ตอน boot** — ทุก env var ใหม่ต้องเพิ่มใน `envSchema` ที่ `src/config/env.ts` (รันผ่าน `ConfigModule.forRoot({ validate: validateEnv })`) แล้วอ่านผ่าน `ConfigService` **ห้าม `process.env` ตรง** — ไม่งั้นเสียคุณสมบัติ fail-fast (พังตอน boot ดีกว่าพังกลาง request).
4. **ทุก controller ต้อง document Swagger** — `@ApiTags` + `@ApiBearerAuth` + `@ApiOkResponse`/`@ApiCreatedResponse`. OpenAPI ที่ `/docs` ถูกใช้ generate TS client ให้ `web` → ถ้า doc ไม่ครบ client เพี้ยน.
5. **api ≠ worker (กฎเหล็ก — เอกสาร 00 §4 ข้อ 1)** — งานยาว (crawl / Ahrefs enrichment / AI / Playwright) **ห้ามรันใน request thread** ต้อง `enqueue` เข้า BullMQ ให้ `worker` app ทำ. controller/service ใน api ต้อง **บางเฉียบ**: validate → enqueue → ตอบ job id/สถานะ.
6. **Auth = Bearer JWT (Clerk) ไม่ใช่ cookie** — CORS ตั้ง `credentials: false`, origin = `WEB_ORIGIN` ใน `main.ts` แล้ว. อย่าเปิด cookie cross-domain.
7. **คอมเมนต์เป็นไทย อ้างเอกสาร** ในรูป `เอกสาร NN §M` (map ไป `../../../../docs/0N-*.md`) ตามสไตล์ repo.

## โครงไฟล์ที่เกี่ยวข้อง (อ้างอิงจริง — ตรวจแล้ว)

```
src/
  main.ts              # bootstrap: pinoHttp · enableCors(Bearer, credentials:false, WEB_ORIGIN)
                       #            · Swagger DocumentBuilder().addBearerAuth() + cleanupOpenApiDoc()
  app.module.ts        # ConfigModule.forRoot({ isGlobal, cache, validate: validateEnv })
                       #   + providers: { provide: APP_PIPE, useClass: ZodValidationPipe }
                       #   + imports: [...domain modules]
  config/env.ts        # envSchema (Zod) + validateEnv (fail-fast) + type Env — แหล่ง env เดียว
  health/              # ⭐ domain ต้นแบบ — copy รูปทรงนี้
    health.module.ts       # @Module({ controllers: [HealthController] })
    health.controller.ts   # @ApiTags('health') @Controller('health') @Get() @ApiOkResponse
```

**ติดตั้งแล้วแต่ยังไม่ wire (สงวนไว้ Phase 1):** `@nestjs/bullmq` `bullmq` `ioredis` `@nestjs/axios`.
`DATABASE_URL` / `REDIS_URL` ยัง `optional` ใน `env.ts` โดยตั้งใจ. **ก่อน enqueue จริงต้อง wire `BullModule.forRootAsync` (Redis) + เปลี่ยน `REDIS_URL` เป็น required ก่อน** — ดูหมายเหตุใน Pattern 5.

**ปลายทาง (monorepo เอกสาร 04):** repo นี้ → `apps/api`; Zod schemas ย้ายไป `packages/shared`; Drizzle → `packages/db`; LangGraph → `packages/ai`. เขียน import แบบที่ย้ายง่าย (schema อยู่ที่เดียว ไม่ซ้ำ).

## ขั้นตอนเมื่อเพิ่ม domain / endpoint ใหม่

1. **เปิด `docs/00-overview-and-stack.md` §4 + เอกสารโดเมนที่เกี่ยว** (03 Ahrefs, 02 AI ...) — ตัดสินว่า logic นี้ควรอยู่ api หรือ worker. ถ้าเป็นงานหนัก/ยาว = ของ worker, api แค่ enqueue.
2. **หา schema ที่มีอยู่ก่อน** — มี Zod schema สำหรับ body/query นี้ใน `src/config/` หรือ (อนาคต) `packages/shared` แล้วหรือยัง อย่าสร้างซ้ำ.
3. สร้างไฟล์ตามรูป `health/`: `dto/` (ถ้ามี input) → `<domain>.controller.ts` → `<domain>.module.ts`.
4. **`import` module เข้า `app.module.ts`** (ขั้นที่ลืมบ่อย — ลืม = endpoint ไม่ทำงาน).
5. document Swagger ให้ครบ แล้ว `npm run build` + `npm run lint`.

## Pattern ครบทุกกรณี (copy-paste ได้ — ปรับชื่อ domain)

### 1. DTO ด้วย Zod (`createZodDto`)
```ts
// src/keywords/dto/create-keyword.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// schema เป็น source of truth — reuse ได้ทั้ง DTO + worker payload + structured output (เอกสาร 04 §6)
export const createKeywordSchema = z.object({
  term: z.string().min(1),
  projectId: z.string().uuid(),
});

// คลาส DTO = adapter บาง ๆ ให้ ZodValidationPipe ตรวจอัตโนมัติ (ไม่ต้อง decorator ราย field)
export class CreateKeywordDto extends createZodDto(createKeywordSchema) {}
```

### 2. Controller (validate body + Swagger ครบ)
```ts
// src/keywords/keywords.controller.ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CreateKeywordDto } from './dto/create-keyword.dto';
import { KeywordsService } from './keywords.service';

@ApiTags('keywords')        // จัดกลุ่มใน /docs → ใช้ตั้งชื่อ client method
@ApiBearerAuth()            // endpoint นี้ต้องมี Bearer (Clerk)
@Controller('keywords')
export class KeywordsController {
  constructor(private readonly keywords: KeywordsService) {}

  @Get(':id')
  @ApiOkResponse({ description: 'Keyword detail' })
  findOne(@Param('id') id: string) {
    return this.keywords.findOne(id); // คืน resource ตรง ๆ — Nest serialize ให้
  }

  @Post()
  @ApiCreatedResponse({ description: 'Keyword queued for enrichment' })
  create(@Body() dto: CreateKeywordDto) {
    // controller บางเฉียบ: ไม่มี business logic — ส่งต่อ service
    return this.keywords.enqueueEnrichment(dto);
  }
}
```

### 3. Module + register เข้า app
```ts
// src/keywords/keywords.module.ts
import { Module } from '@nestjs/common';
import { KeywordsController } from './keywords.controller';
import { KeywordsService } from './keywords.service';

@Module({
  controllers: [KeywordsController],
  providers: [KeywordsService],
})
export class KeywordsModule {}
```
```ts
// src/app.module.ts — เพิ่มใน imports (ขั้นที่ลืมบ่อยที่สุด)
imports: [
  ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
  HealthModule,
  KeywordsModule, // ⬅ ไม่ใส่ = endpoint ไม่ถูก mount
],
```

### 4. อ่าน config / secret — ผ่าน `ConfigService` เท่านั้น
```ts
// src/keywords/keywords.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class KeywordsService {
  constructor(private readonly config: ConfigService) {}

  someCall() {
    // ✅ ConfigService (typed, validated)         ❌ process.env.AHREFS_API_KEY
    const key = this.config.get<string>('AHREFS_API_KEY');
    // ...
  }
}
```
เพิ่ม env var ใหม่ → ต้องประกาศใน `envSchema` ก่อน (ไม่งั้นได้ `undefined` เงียบ ๆ เสีย fail-fast):
```ts
// src/config/env.ts
export const envSchema = z.object({
  // ...ของเดิม
  AHREFS_API_KEY: z.string().min(1), // เพิ่มใหม่ — required → boot ล้มทันทีถ้าไม่ตั้ง (เอกสาร 03)
});
```

### 5. งานหนัก → enqueue BullMQ (api ≠ worker)
```ts
// src/keywords/keywords.module.ts — ลงทะเบียน queue ของ domain
import { BullModule } from '@nestjs/bullmq';
@Module({
  imports: [BullModule.registerQueue({ name: 'enrich' })],
  controllers: [KeywordsController],
  providers: [KeywordsService],
})
export class KeywordsModule {}
```
```ts
// src/keywords/keywords.service.ts
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

constructor(@InjectQueue('enrich') private readonly enrichQueue: Queue) {}

async enqueueEnrichment(dto: CreateKeywordDto) {
  // api แค่ตั้งงาน — worker (process แยก) เป็นคนเรียก Ahrefs/AI จริง (เอกสาร 00 §4 ข้อ 1)
  const job = await this.enrichQueue.add('enrich-keyword', { ...dto });
  return { jobId: job.id, status: 'queued' };
}
```
> ⚠️ **ยังไม่ wire:** ต้องตั้ง `BullModule.forRootAsync` (Redis connection จาก `REDIS_URL`) ใน `app.module.ts` และเปลี่ยน `REDIS_URL` เป็น required ใน `env.ts` ก่อน เป็นงาน Phase 1. จนกว่าจะ wire อย่าเพิ่ง `registerQueue` จริง — แต่ยึดกฎ "api แค่ enqueue" ไว้ตั้งแต่ออกแบบ.

### 6. Public endpoint (ไม่ต้อง Bearer)
```ts
// ปล่อยว่าง ไม่ใส่ @ApiBearerAuth (ตอนนี้ยังไม่มี global auth guard — secure-by-default ยังไม่บังคับ)
// health คือตัวอย่าง public: @ApiTags('health') @Controller('health') ... ไม่มี @ApiBearerAuth
```
> หมายเหตุ: ปัจจุบัน repo ยังไม่มี auth guard กลาง (ขั้น setup). เมื่อ Phase 1 เพิ่ม Clerk guard ให้บังคับ Bearer เป็น default แล้ว public endpoint จึงค่อย opt-out — ตอนนี้ `@ApiBearerAuth` เป็น "เอกสาร" ว่า endpoint ไหน *ควร* ต้อง auth.

## Decision Matrix

| สิ่งที่ต้องทำ | ใช้ |
|---|---|
| Validate body | `createZodDto(schema)` + `@Body() dto` |
| Validate query / params | `@Query()` / `@Param()` + Zod DTO หรือ `schema.parse(...)` |
| Domain ใหม่ | `<domain>.module.ts` + `.controller.ts` (+ `.service.ts`) → register ใน `app.module.ts` |
| อ่าน config / secret | `ConfigService.get<T>('KEY')` (เพิ่มใน `env.ts` ก่อน) |
| Env var ใหม่ | เพิ่ม field ใน `envSchema` (`src/config/env.ts`) |
| งานหนัก/ยาว (crawl/Ahrefs/AI) | enqueue BullMQ → worker (อย่าทำใน request) |
| HTTP ภายนอก (Ahrefs ฯลฯ) | `@nestjs/axios` `HttpService` (ติดตั้งแล้ว) — แต่ call หนักควรอยู่ worker |
| Document endpoint | `@ApiTags` + `@ApiBearerAuth` + `@ApiOkResponse`/`@ApiCreatedResponse` |
| Logging | `pinoHttp` ทำ request log ให้แล้ว (`main.ts`) — อย่า `console.log` |

## ห้ามทำ

- ❌ `class-validator` / `@IsString()` ราย field → ใช้ Zod + `createZodDto` (validation layer เดียว)
- ❌ `process.env.X` ตรงใน controller/service → `ConfigService.get(...)` + เพิ่มใน `envSchema`
- ❌ เพิ่ม env var แต่ไม่ใส่ใน `envSchema` → อ่านได้ `undefined` เงียบ ๆ เสีย fail-fast
- ❌ รัน crawl / Ahrefs / AI / Playwright / blocking I/O หนัก ใน controller/service ของ api → enqueue BullMQ ให้ worker
- ❌ Business logic อ้วนใน controller → controller เป็น adapter บาง, ย้าย logic ลง service
- ❌ ลืม `import` module ใน `app.module.ts` → endpoint ไม่ถูก mount (ไม่ error แต่ 404)
- ❌ ลืม `@ApiTags`/`@ApiResponse` → OpenAPI ไม่ครบ → TS client ที่ gen ให้ `web` เพี้ยน
- ❌ เปิด cookie / `credentials: true` สำหรับ auth → ใช้ Bearer JWT (Clerk) เท่านั้น (`main.ts` ตั้ง `credentials: false`)
- ❌ ใช้ schema เดียวเป็นทั้ง input DTO และ response type — input/output คนละทิศ แยก schema
- ❌ สร้าง Zod schema ซ้ำที่มีใน `config/`/(อนาคต)`shared` แล้ว — ประกาศครั้งเดียว reuse
- ❌ `console.log`/`console.error` ใน handler → ใช้ pino (request log มีให้แล้ว)

## เมื่อแตะโค้ดเก่าที่ยังไม่ตรง convention

ขั้น setup ยังโค้ดน้อย แต่ถ้าเจอ — แก้ตอนที่แตะ ไม่ต้องรื้อทั้ง repo:
1. DTO ที่ใช้ `class-validator` → แปลงเป็น `createZodDto`.
2. `process.env.X` → ย้ายไป `ConfigService` + เติม field ใน `envSchema`.
3. งานหนักใน request thread → ย้ายเป็น enqueue (หรือ mark TODO ชี้ worker ถ้ายังไม่ wire Redis).
4. controller ที่ขาด Swagger decorator → เติมให้ครบ.

## Checklist ก่อน commit (domain/endpoint ใหม่หรือแก้)

- [ ] DTO ใช้ `createZodDto` (ไม่มี `class-validator`)
- [ ] Body/query/params validate ด้วย Zod (reuse schema เดิมก่อนสร้างใหม่)
- [ ] Module ถูก `import` ใน `app.module.ts`
- [ ] ทุก controller method มี `@ApiTags` + `@ApiResponse` ที่เหมาะสม (+ `@ApiBearerAuth` ถ้าต้อง auth)
- [ ] อ่าน env ผ่าน `ConfigService` — env var ใหม่อยู่ใน `envSchema` แล้ว
- [ ] ไม่มีงานหนัก/blocking ใน request thread (งานยาว = enqueue หรือ TODO ชี้ worker)
- [ ] Controller บาง — business logic อยู่ใน service
- [ ] `npm run build` ผ่าน + `npm run lint` ผ่าน
