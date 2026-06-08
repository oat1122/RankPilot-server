import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiRepo } from './ai.repo';
import { AiConfigRepo } from './ai-config.repo';
import { PAGE_AUDIT_ENGINE } from './ai.tokens';
import type { PageAuditEngine } from './page-audit/engine';
import type { ReviewDecision } from './page-audit/state';
import { toRecommendationRows } from './page-audit/recommendations';

/** payload ของ job 'audit-page' (queue 'ai') — producer เตรียมให้ (1 job = 1 เพจ). */
export interface PageAuditJobData {
  projectId: number;
  pageId: number;
  crawlId?: number;
}

/** payload ของ job 'resume-review' (queue 'ai') — user อนุมัติ/ปฏิเสธใน dashboard (Phase 4). */
export interface PageAuditResumeJobData {
  projectId: number;
  pageId: number;
  runId: number;
  decision: ReviewDecision;
  note?: string;
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
  // Phase 4: 'awaiting_review' = ค้างรอ user อนุมัติ (HITL); 'done' = persist แล้ว (approve/HITL ปิด)
  status: 'done' | 'awaiting_review';
}

/** thread_id แยกต่อ run → checkpoint ไม่ชน + resume ตรง run ได้ (เอกสาร 02 §6). */
const threadIdFor = (pageId: number, runId: number): string =>
  `page:${pageId}:run:${runId}`;

/**
 * AiRunner — stage [4] AI Advisor (เอกสาร 02): orchestrate lifecycle ของ ai_runs รอบ graph
 * `page_audit` ต่อ 1 เพจ. รันใน worker เท่านั้น (เอกสาร 00 §4) ผ่าน AiProcessor. การยิง langgraph
 * (invoke/interrupt/resume/cleanup) อยู่หลัง PageAuditEngine (inject ผ่าน PAGE_AUDIT_ENGINE) →
 * runner ไม่ผูก langgraph (unit test มॉค engine ได้). Phase 4 (HITL): auditPage อาจหยุดที่
 * awaitReview (interrupted) → ค้าง run เป็น awaiting_review; resumeReview เดินต่อหลัง user อนุมัติ.
 */
@Injectable()
export class AiRunner {
  private readonly logger = new Logger(AiRunner.name);

  constructor(
    private readonly repo: AiRepo,
    private readonly configRepo: AiConfigRepo,
    @Inject(PAGE_AUDIT_ENGINE) private readonly engine: PageAuditEngine,
  ) {}

  async auditPage(job: PageAuditJobData): Promise<PageAuditSummary> {
    // snapshot role→modelId ที่ใช้จริงรอบนี้ (Phase 5: ai_settings ต่อโปรเจค หรือ DEFAULTS) →
    // audit ต้นทุน/คุณภาพย้อนหลัง (เอกสาร 02 §6)
    const models = await this.configRepo.resolveModelMap(job.projectId);
    const runId = await this.repo.createRun({
      projectId: job.projectId,
      pageId: job.pageId,
      graph: 'page_audit',
      models,
    });
    const threadId = threadIdFor(job.pageId, runId);

    try {
      const { state, interrupted } = await this.engine.run(
        {
          pageId: job.pageId,
          projectId: job.projectId,
          runId,
          crawlId: job.crawlId,
        },
        threadId,
      );

      const proposal = toRecommendationRows(state);
      const tokensIn = state.tokensIn ?? 0;
      const tokensOut = state.tokensOut ?? 0;
      const draftAttempts = state.draftAttempts ?? 0;

      // Phase 4 (HITL): graph หยุดที่ awaitReview → persist ยังไม่รัน. ค้าง run เป็น awaiting_review
      // + เก็บ proposal ให้ dashboard โชว์ก่อน approve/reject.
      if (interrupted) {
        await this.repo.setAwaitingReview(runId, {
          reviewPayload: proposal,
          tokensIn,
          tokensOut,
        });
        this.logger.log(
          `ai#${job.projectId} page=${job.pageId} run=${runId} awaiting_review ` +
            `proposal=${proposal.length} tokens=${tokensIn}/${tokensOut}`,
        );
        return {
          projectId: job.projectId,
          pageId: job.pageId,
          runId,
          recommendationsCreated: 0,
          draftAttempts,
          tokensIn,
          tokensOut,
          status: 'awaiting_review',
        };
      }

      // HITL ปิด → graph เดินถึง persist แล้ว (run=done, recs เขียนแล้ว)
      const summary: PageAuditSummary = {
        projectId: job.projectId,
        pageId: job.pageId,
        runId,
        recommendationsCreated: proposal.length,
        draftAttempts,
        tokensIn,
        tokensOut,
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
      // run ล้ม (เช่น LLM 402/429 ตอน OpenRouter ไม่มีเครดิต) → checkpoint ที่ langgraph เขียนไว้
      // ใช้ resume ไม่ได้แล้ว ลบทิ้ง best-effort กัน ai_checkpoints บวม (เทียบ resumeReview).
      await this.engine.cleanup(threadId).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Phase 4 (HITL): resume graph ที่ค้างที่ awaitReview ด้วยผลรีวิว. approve → persist เขียน recs;
   * reject → persist ปิด run โดยไม่เขียน. หลัง terminal ลบ checkpoint (best-effort) กัน table บวม.
   */
  async resumeReview(job: PageAuditResumeJobData): Promise<PageAuditSummary> {
    const threadId = threadIdFor(job.pageId, job.runId);
    try {
      const state = await this.engine.resume(threadId, job.decision);
      await this.engine
        .cleanup(threadId)
        .catch((e: unknown) =>
          this.logger.warn(
            `cleanup checkpoint ล้มเหลว run=${job.runId}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );

      const created =
        job.decision === 'reject' ? 0 : toRecommendationRows(state).length;
      this.logger.log(
        `ai resume run=${job.runId} page=${job.pageId} decision=${job.decision} recs=${created}`,
      );
      return {
        projectId: job.projectId,
        pageId: job.pageId,
        runId: job.runId,
        recommendationsCreated: created,
        draftAttempts: state.draftAttempts ?? 0,
        tokensIn: state.tokensIn ?? 0,
        tokensOut: state.tokensOut ?? 0,
        status: 'done',
      };
    } catch (err) {
      await this.repo.failRun(job.runId).catch(() => undefined);
      throw err;
    }
  }
}
