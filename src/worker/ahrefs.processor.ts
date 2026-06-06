import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EnrichmentService } from '../ahrefs/enrichment.service';
import type {
  EnrichOrganicJobData,
  EnrichmentSummary,
} from '../ahrefs/enrichment.service';

/** RateLimiter ระดับ queue (เอกสาร 03 §5) — ≤5 req/วินาที กัน Ahrefs ตอบ 429.
 *  hardcode ตรงนี้ ∵ @Processor decorator ประเมินตอน class-def (อ่าน ConfigService ไม่ได้). */
const AHREFS_LIMITER = { max: 5, duration: 1000 } as const;

/**
 * Consumer ของ queue 'ahrefs' — รันใน worker process แยกจาก api (เอกสาร 00 §4).
 * limiter กัน 429; คืน EnrichmentSummary → BullMQ เก็บเป็น job.returnvalue ให้ api
 * อ่านผ่าน GET /projects/:id/ahrefs/enrich/:jobId.
 */
@Processor('ahrefs', { limiter: AHREFS_LIMITER })
export class AhrefsProcessor extends WorkerHost {
  private readonly logger = new Logger(AhrefsProcessor.name);

  constructor(private readonly enrichment: EnrichmentService) {
    super();
  }

  async process(job: Job<EnrichOrganicJobData>): Promise<EnrichmentSummary> {
    this.logger.log(
      `ahrefs#${job.id} → enrich ${job.data.domain} (project ${job.data.projectId}, limit ${job.data.limit})`,
    );
    const summary = await this.enrichment.enrichOrganicKeywords(job.data);
    this.logger.log(
      `ahrefs#${job.id} done kw=${summary.keywordsUpserted} units=${summary.unitsSpent} cached=${summary.cached}`,
    );
    return summary;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EnrichOrganicJobData>, err: Error) {
    this.logger.error(`ahrefs#${job?.id} failed: ${err.message}`);
  }

  // กัน connection error (Redis ล่ม) ทำให้ worker process ล้มแบบ unhandled
  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`ahrefs worker error: ${err.message}`);
  }
}
