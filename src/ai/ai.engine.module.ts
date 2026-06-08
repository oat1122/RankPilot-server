import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiRepo } from './ai.repo';
import { AiRunner } from './ai.runner';
import { PAGE_AUDIT_GRAPH } from './ai.tokens';
import { buildPageAuditGraph } from './page-audit/graph';
import { mkModel } from './llm/openrouter';
import type { OpenRouterConn } from './llm/openrouter';
import { resolveModelCfg } from './llm/resolve';
import type { Role } from './llm/resolve';

/**
 * compiled page_audit graph เป็น singleton — สร้างครั้งเดียวตอน module init แล้ว reuse ทุก job.
 * factory อ่าน OPENROUTER_* ผ่าน ConfigService (ไม่ใช่ process.env ตรง — เอกสาร 00 §1) แล้ว
 * ฉีด resolveModel(role) เข้า graph. mkModel ถูกเรียก "ตอน invoke โหนด" เท่านั้น ∴ สร้าง graph
 * ได้แม้ยังไม่มี OPENROUTER_API_KEY (จะ throw AI_NOT_CONFIGURED ตอนรันจริง).
 */
const pageAuditGraphProvider: Provider = {
  provide: PAGE_AUDIT_GRAPH,
  inject: [AiRepo, ConfigService],
  useFactory: (repo: AiRepo, config: ConfigService) => {
    const conn: OpenRouterConn = {
      apiKey: config.get<string>('OPENROUTER_API_KEY'),
      baseURL: config.get<string>('OPENROUTER_BASE_URL')!,
      siteUrl: config.get<string>('OPENROUTER_SITE_URL')!,
      appTitle: config.get<string>('OPENROUTER_APP_TITLE')!,
      timeoutMs: config.get<number>('OPENROUTER_TIMEOUT_MS'),
    };
    return buildPageAuditGraph({
      repo,
      resolveModel: (role: Role) => mkModel(resolveModelCfg(role), conn),
    });
  },
};

/**
 * Engine ของ stage [4] AI Advisor (shared) — provide AiRunner (รัน graph) + AiRepo +
 * compiled graph โดยไม่มี controller/queue เพื่อให้ทั้ง worker (AiProcessor) และ api
 * (AiModule producer) import ใช้ซ้ำได้ ตามกฎ api ≠ worker (เทียบ AnalysisEngineModule).
 * DB inject ผ่าน token @Global (DbModule) → ไม่ต้อง import เพิ่ม.
 */
@Module({
  providers: [AiRepo, AiRunner, pageAuditGraphProvider],
  exports: [AiRepo, AiRunner],
})
export class AiEngineModule {}
