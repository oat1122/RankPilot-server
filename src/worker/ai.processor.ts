import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AiRunner } from '../ai/ai.runner';
import type {
  PageAuditJobData,
  PageAuditResumeJobData,
  PageAuditSummary,
} from '../ai/ai.runner';

type AiJobData = PageAuditJobData | PageAuditResumeJobData;

/**
 * Consumer ของ queue 'ai' — รันใน worker process แยกจาก api (เอกสาร 00 §4).
 * 2 ชนิดงาน: 'audit-page' (รัน graph ต่อเพจ) และ 'resume-review' (Phase 4 HITL: resume graph
 * หลัง user อนุมัติใน dashboard). คืน PageAuditSummary → BullMQ เก็บเป็น job.returnvalue ให้ api
 * อ่านผ่าน GET /projects/:id/ai/jobs/:jobId. การรัน graph อยู่ใน AiRunner (engine).
 */
@Processor('ai')
export class AiProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessor.name);

  constructor(private readonly runner: AiRunner) {
    super();
  }

  async process(job: Job<AiJobData>): Promise<PageAuditSummary> {
    if (job.name === 'resume-review') {
      const data = job.data as PageAuditResumeJobData;
      this.logger.log(
        `ai#${job.id} resume-review run=${data.runId} page=${data.pageId} decision=${data.decision}`,
      );
      return this.runner.resumeReview(data);
    }
    const data = job.data as PageAuditJobData;
    this.logger.log(
      `ai#${job.id} ${job.name} (project ${data.projectId} page ${data.pageId})`,
    );
    return this.runner.auditPage(data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AiJobData>, err: Error) {
    this.logger.error(`ai#${job?.id} failed: ${err.message}`);
  }

  // กัน connection error (Redis ล่ม) ทำให้ worker process ล้มแบบ unhandled
  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`ai worker error: ${err.message}`);
  }
}
