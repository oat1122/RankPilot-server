import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SiteReportRunner } from '../report/site-report.runner';
import type {
  SiteReportJobData,
  SiteReportSummary,
} from '../report/site-report.types';

/**
 * Consumer ของ queue 'report' — รันใน worker process แยกจาก api (เอกสาร 00 §4). คืน
 * SiteReportSummary → BullMQ เก็บเป็น job.returnvalue ให้ api อ่านผ่าน GET report-status/:jobId.
 * ตรรกะ orchestrate (Ahrefs+WHOIS+meta+AI) อยู่ใน SiteReportRunner (engine).
 */
@Processor('report')
export class ReportProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportProcessor.name);

  constructor(private readonly runner: SiteReportRunner) {
    super();
  }

  async process(job: Job<SiteReportJobData>): Promise<SiteReportSummary> {
    this.logger.log(
      `report#${job.id} ${job.name} (project ${job.data.projectId})`,
    );
    return this.runner.generate(job.data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<SiteReportJobData>, err: Error) {
    this.logger.error(`report#${job?.id} failed: ${err.message}`);
  }

  // กัน connection error (Redis ล่ม) ทำให้ worker process ล้มแบบ unhandled
  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`report worker error: ${err.message}`);
  }
}
