import { Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { AiRepo } from './ai.repo';
import { AiConfigRepo } from './ai-config.repo';
import { AiRunner } from './ai.runner';
import { PAGE_AUDIT_ENGINE } from './ai.tokens';
import { buildPageAuditGraph } from './page-audit/graph';
import { PageAuditEngine } from './page-audit/engine';
import { MariaDbSaver } from './checkpoint/mariadb-saver';
import { mkModel } from './llm/openrouter';
import type { OpenRouterConn } from './llm/openrouter';
import { renderSkills } from './skills/render';
import { VoyageClient } from './embeddings/voyage.client';
import { EmbeddingService } from './embeddings/embedding.service';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';

/**
 * PageAuditEngine (compiled graph + checkpointer + langgraph coupling) เป็น singleton — สร้าง
 * ครั้งเดียวตอน module init แล้ว reuse ทุก job. factory อ่าน OPENROUTER_* + AI_HITL_ENABLED ผ่าน
 * ConfigService (ไม่ใช่ process.env ตรง — เอกสาร 00 §1). Phase 5: ฉีด prep(projectId,role,node) ที่
 * resolve model ต่อโปรเจค (ai_settings ผ่าน AiConfigRepo) + skills ที่ apply กับ node (ai_skills →
 * renderSkills). mkModel ถูกเรียก "ตอน invoke โหนด" เท่านั้น ∴ สร้าง engine ได้แม้ยังไม่มี
 * OPENROUTER_API_KEY. Phase 4: checkpointer ถาวร (MariaDB) → interrupt/resume ข้าม process ได้.
 */
const pageAuditEngineProvider: Provider = {
  provide: PAGE_AUDIT_ENGINE,
  inject: [AiRepo, AiConfigRepo, ConfigService, DB],
  useFactory: (
    repo: AiRepo,
    configRepo: AiConfigRepo,
    config: ConfigService,
    db: Db,
  ) => {
    const conn: OpenRouterConn = {
      apiKey: config.get<string>('OPENROUTER_API_KEY'),
      baseURL: config.get<string>('OPENROUTER_BASE_URL')!,
      siteUrl: config.get<string>('OPENROUTER_SITE_URL')!,
      appTitle: config.get<string>('OPENROUTER_APP_TITLE')!,
      timeoutMs: config.get<number>('OPENROUTER_TIMEOUT_MS'),
    };
    const checkpointer = new MariaDbSaver(db);
    const graph = buildPageAuditGraph({
      repo,
      // Phase 5: model ต่อโปรเจค (ai_settings) + skills รายโหนด (ai_skills) — resolve ตอน invoke
      prep: async (projectId, role, node) => ({
        llm: mkModel(await configRepo.resolveModelCfg(projectId, role), conn),
        skills: renderSkills(
          await configRepo.resolveSkillsForNode(projectId, node),
        ),
      }),
      checkpointer,
      hitl: config.get<boolean>('AI_HITL_ENABLED'),
    });
    return new PageAuditEngine(graph, checkpointer);
  },
};

/**
 * Engine ของ stage [4] AI Advisor (shared) — provide AiRunner (orchestrate graph) + AiRepo +
 * AiConfigRepo (settings/skills) + EmbeddingService (Voyage, Phase 6) + PageAuditEngine โดยไม่มี
 * controller/queue เพื่อให้ทั้ง worker (AiProcessor) และ api (AiModule producer) import ใช้ซ้ำได้
 * ตามกฎ api ≠ worker. DB inject ผ่าน token @Global (DbModule). HttpModule → VoyageClient.
 */
@Module({
  imports: [HttpModule],
  providers: [
    AiRepo,
    AiConfigRepo,
    AiRunner,
    VoyageClient,
    EmbeddingService,
    pageAuditEngineProvider,
  ],
  exports: [AiRepo, AiConfigRepo, AiRunner],
})
export class AiEngineModule {}
