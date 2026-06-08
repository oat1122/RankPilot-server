import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AiRunner } from '../ai/ai.runner';
import type { PageAuditJobData, PageAuditSummary } from '../ai/ai.runner';

/**
 * Consumer ของ queue 'ai' — รันใน worker process แยกจาก api (เอกสาร 00 §4).
 * คืน PageAuditSummary → BullMQ เก็บเป็น job.returnvalue ให้ api อ่านผ่าน
 * GET /projects/:id/ai/jobs/:jobId. การรัน graph `page_audit` อยู่ใน AiRunner (engine).
 */
@Processor('ai')
export class AiProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessor.name);

  constructor(private readonly runner: AiRunner) {
    super();
  }

  async process(job: Job<PageAuditJobData>): Promise<PageAuditSummary> {
    this.logger.log(
      `ai#${job.id} ${job.name} (project ${job.data.projectId} page ${job.data.pageId})`,
    );
    return this.runner.auditPage(job.data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<PageAuditJobData>, err: Error) {
    this.logger.error(`ai#${job?.id} failed: ${err.message}`);
  }

  // กัน connection error (Redis ล่ม) ทำให้ worker process ล้มแบบ unhandled
  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`ai worker error: ${err.message}`);
  }
}
