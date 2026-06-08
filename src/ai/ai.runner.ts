import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiRepo } from './ai.repo';
import { PAGE_AUDIT_GRAPH } from './ai.tokens';
import type { PageAuditGraph } from './page-audit/graph';
import { DEFAULTS } from './llm/resolve';
import { toRecommendationRows } from './page-audit/recommendations';

/** payload ของ job 'audit-page' (queue 'ai') — producer เตรียมให้ (1 job = 1 เพจ). */
export interface PageAuditJobData {
  projectId: number;
  pageId: number;
  crawlId?: number;
}

/** สรุปผล audit ต่อเพจ — เก็บเป็น job.returnvalue ให้ api อ่านผ่าน GET status. */
export interface PageAuditSummary {
  projectId: number;
  pageId: number;
  runId: number;
  recommendationsCreated: number;
  draftAttempts: number;
  tokensIn: number;
  tokensOut: number;
  status: 'done';
}

/**
 * AiRunner — stage [4] AI Advisor (เอกสาร 02): รัน graph `page_audit` ต่อ 1 เพจ ผ่าน
 * OpenRouter (live). รันใน worker เท่านั้น (เอกสาร 00 §4) ผ่าน AiProcessor. compiled graph
 * inject ผ่าน token PAGE_AUDIT_GRAPH (สร้างใน AiEngineModule) → runner ไม่ผูก langgraph ตรง ๆ
 * (unit test มॉค graph ได้). lifecycle ของ ai_runs (create/finish/fail) คุมที่นี่.
 */
@Injectable()
export class AiRunner {
  private readonly logger = new Logger(AiRunner.name);

  constructor(
    private readonly repo: AiRepo,
    @Inject(PAGE_AUDIT_GRAPH) private readonly graph: PageAuditGraph,
  ) {}

  async auditPage(job: PageAuditJobData): Promise<PageAuditSummary> {
    // snapshot role→modelId ที่ใช้รอบนี้ (Phase 1 = DEFAULTS) → audit ต้นทุนย้อนหลัง (เอกสาร 02 §6)
    const models = {
      reasoner: DEFAULTS.reasoner.modelId,
      worker: DEFAULTS.worker.modelId,
      cheap: DEFAULTS.cheap.modelId,
    };
    const runId = await this.repo.createRun({
      projectId: job.projectId,
      pageId: job.pageId,
      graph: 'page_audit',
      models,
    });

    try {
      const final = await this.graph.invoke(
        {
          pageId: job.pageId,
          projectId: job.projectId,
          runId,
          crawlId: job.crawlId,
        },
        // thread_id แยกต่อ run → checkpoint ไม่ชน (เอกสาร 02 §6)
        { configurable: { thread_id: `page:${job.pageId}:run:${runId}` } },
      );

      const summary: PageAuditSummary = {
        projectId: job.projectId,
        pageId: job.pageId,
        runId,
        recommendationsCreated: toRecommendationRows(final).length,
        draftAttempts: final.draftAttempts ?? 0,
        tokensIn: final.tokensIn ?? 0,
        tokensOut: final.tokensOut ?? 0,
        status: 'done',
      };
      this.logger.log(
        `ai#${job.projectId} page=${job.pageId} run=${runId} ` +
          `recs=${summary.recommendationsCreated} attempts=${summary.draftAttempts} ` +
          `tokens=${summary.tokensIn}/${summary.tokensOut}`,
      );
      return summary;
    } catch (err) {
      await this.repo.failRun(runId).catch(() => undefined);
      throw err;
    }
  }
}
