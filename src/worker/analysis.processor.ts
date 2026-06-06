import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AnalysisRunner } from '../analysis/analysis.runner';
import type {
  AnalyzeCrawlJobData,
  AnalysisSummary,
} from '../analysis/analysis.runner';

/**
 * Consumer ของ queue 'analysis' — รันใน worker process แยกจาก api (เอกสาร 00 §4).
 * คืน AnalysisSummary → BullMQ เก็บเป็น job.returnvalue ให้ api อ่านผ่าน
 * GET /projects/:id/analysis/jobs/:jobId. ตรรกะคำนวณอยู่ใน AnalysisRunner (engine).
 */
@Processor('analysis')
export class AnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(private readonly runner: AnalysisRunner) {
    super();
  }

  async process(job: Job<AnalyzeCrawlJobData>): Promise<AnalysisSummary> {
    this.logger.log(
      `analysis#${job.id} ${job.name} (project ${job.data.projectId})`,
    );
    return this.runner.analyzeCrawl(job.data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AnalyzeCrawlJobData>, err: Error) {
    this.logger.error(`analysis#${job?.id} failed: ${err.message}`);
  }

  // กัน connection error (Redis ล่ม) ทำให้ worker process ล้มแบบ unhandled
  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`analysis worker error: ${err.message}`);
  }
}
