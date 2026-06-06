import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ZodValidationPipe } from 'nestjs-zod';
import { validateEnv } from './config/env';
import { bullRootAsyncOptions } from './queue/bull.config';
import { CommonModule } from './common/common.module';
import { HealthModule } from './health/health.module';
import { CrawlModule } from './crawl/crawl.module';
import { EnrichModule } from './enrich/enrich.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    // BullMQ root (Redis) — api เป็น producer; consumer อยู่ใน worker (เอกสาร 00 §4)
    BullModule.forRootAsync(bullRootAsyncOptions),
    // ชั้นกลาง FE↔BE: response envelope + error filter (เอกสาร 04 §6)
    CommonModule,
    HealthModule,
    CrawlModule,
    // Ahrefs Enrichment [2] (producer) — POST/GET /projects/:id/ahrefs/* (เอกสาร 03)
    EnrichModule,
  ],
  providers: [
    // validate ทุก request ที่ใช้ createZodDto ทั่วแอป (เอกสาร 04 §6)
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule {}
