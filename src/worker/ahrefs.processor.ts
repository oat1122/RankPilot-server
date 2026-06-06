import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EnrichmentService } from '../ahrefs/enrichment.service';
import type {
  EnrichOrganicJobData,
  EnrichKeywordsJobData,
  TopPagesJobData,
  EnrichmentSummary,
  KeywordOverviewSummary,
  TopPagesSummary,
} from '../ahrefs/enrichment.service';

/** RateLimiter ระดับ queue (เอกสาร 03 §5) — ≤5 req/วินาที กัน Ahrefs ตอบ 429.
 *  hardcode ตรงนี้ ∵ @Processor decorator ประเมินตอน class-def (อ่าน ConfigService ไม่ได้). */
const AHREFS_LIMITER = { max: 5, duration: 1000 } as const;

/** ทุก job ของ queue 'ahrefs' — แยกด้วย job.name (discriminator). */
type AhrefsJobData =
  | EnrichOrganicJobData
  | EnrichKeywordsJobData
  | TopPagesJobData;
type AhrefsJobResult =
  | EnrichmentSummary
  | KeywordOverviewSummary
  | TopPagesSummary;

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

  async process(job: Job<AhrefsJobData>): Promise<AhrefsJobResult> {
    this.logger.log(
      `ahrefs#${job.id} ${job.name} (project ${job.data.projectId})`,
    );
    // แยกตาม job.name — แต่ละ enqueue ตั้งชื่อให้ตรง flow (เอกสาร 03a §3/§4).
    switch (job.name) {
      case 'enrich-organic':
        return this.enrichment.enrichOrganicKeywords(
          job.data as EnrichOrganicJobData,
        );
      case 'enrich-keywords':
        return this.enrichment.enrichKeywordOverview(
          job.data as EnrichKeywordsJobData,
        );
      case 'top-pages':
        return this.enrichment.selectTopPages(job.data as TopPagesJobData);
      default:
        throw new Error(`unknown ahrefs job '${job.name}'`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AhrefsJobData>, err: Error) {
    this.logger.error(`ahrefs#${job?.id} ${job?.name} failed: ${err.message}`);
  }

  // กัน connection error (Redis ล่ม) ทำให้ worker process ล้มแบบ unhandled
  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.warn(`ahrefs worker error: ${err.message}`);
  }
}
