import { Module } from '@nestjs/common';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import { validateEnv } from './config/env';
import { bullRootAsyncOptions } from './queue/bull.config';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { ClerkAuthGuard } from './auth/clerk-auth.guard';
import { HealthModule } from './health/health.module';
import { AppConfigModule } from './app-config/app-config.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { CrawlModule } from './crawl/crawl.module';
import { PagesModule } from './pages/pages.module';
import { EnrichModule } from './enrich/enrich.module';
import { ReportModule } from './report/report.module';
import { AnalysisModule } from './analysis/analysis.module';
import { AiModule } from './ai/ai.module';
import { TrendsModule } from './trends/trends.module';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    // BullMQ root (Redis) — api เป็น producer; consumer อยู่ใน worker (เอกสาร 00 §4)
    BullModule.forRootAsync(bullRootAsyncOptions),
    // Rate limit ระดับ api (security baseline) — ค่า ttl/limit จาก env (THROTTLE_*).
    // storage in-memory (1 instance); หลายอินสแตนซ์ค่อยต่อ Redis storage ภายหลัง.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('THROTTLE_TTL_MS') ?? 60_000,
            limit: config.get<number>('THROTTLE_LIMIT') ?? 120,
          },
        ],
      }),
    }),
    // ชั้นกลาง FE↔BE: response envelope + error filter (เอกสาร 04 §6)
    CommonModule,
    // auth layer (Clerk Bearer) — providers ให้ ClerkAuthGuard ด้านล่าง (เอกสาร 05 §4)
    AuthModule,
    HealthModule,
    // GET /config (public) — เปิดเผย config ที่ FE ใช้ build UI (เพดาน site crawl ฯลฯ)
    AppConfigModule,
    // UserManager (@Roles admin) — list/เชิญ/เปลี่ยน role/soft-disable user; ไม่มี self sign-up (เอกสาร 05 §4)
    UsersModule,
    // Projects (@Global) — list/detail/create + ProjectAccessGuard ที่ domain อื่น reuse (เอกสาร 01 §2)
    ProjectsModule,
    CrawlModule,
    // Pages (read-only) — list หน้าที่ crawl มา + page detail สำหรับ dashboard ใหม่
    PagesModule,
    // Ahrefs Enrichment [2] (producer) — POST/GET /projects/:id/ahrefs/* (เอกสาร 03)
    EnrichModule,
    // รายงานเว็บเต็ม (producer) — POST/GET /projects/:id/ahrefs/{site-report,report} (Ahrefs+WHOIS+AI)
    ReportModule,
    // Analysis [3] (producer) — POST/GET /projects/:id/analysis/* (เอกสาร 04 §7)
    AnalysisModule,
    // AI Advisor [4] (producer) — POST/GET /projects/:id/ai/* (เอกสาร 02)
    AiModule,
    // Trends [5] — GET /projects/:id/trends/* (score + crawl activity, เอกสาร 06)
    TrendsModule,
    // Jobs — GET /jobs: รวมสถานะงานทุกคิวของ user (in-progress รอด refresh + กระดิ่งแจ้งเตือน)
    JobsModule,
  ],
  providers: [
    // validate ทุก request ที่ใช้ createZodDto ทั่วแอป (เอกสาร 04 §6)
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // rate limit ทุก request (per-IP) — กัน abuse/DoS. worker ไม่มี HTTP จึงไม่ผูก guard นี้.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // auth secure-by-default — รันต่อจาก ThrottlerGuard (ลำดับตามการ declare ที่ AppModule นี้).
    // verify Bearer (Clerk) ทุก endpoint ยกเว้น @Public; แนบ req.user (เอกสาร 05 §4).
    { provide: APP_GUARD, useClass: ClerkAuthGuard },
  ],
})
export class AppModule {}
