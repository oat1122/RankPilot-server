import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { EnrichmentService } from '../ahrefs/enrichment.service';
import type {
  EnrichOrganicJobData,
  EnrichKeywordsJobData,
  TopPagesJobData,
  CompetitorsJobData,
  SerpOverviewJobData,
  KeywordIdeasJobData,
  BacklinksJobData,
  EnrichmentSummary,
  KeywordOverviewSummary,
  TopPagesSummary,
  CompetitorsSummary,
  SerpOverviewSummary,
  KeywordIdeasSummary,
  BacklinksSummary,
} from '../ahrefs/enrichment.service';

/** RateLimiter ระดับ queue (เอกสาร 03 §5) — ≤5 req/วินาที กัน Ahrefs ตอบ 429.
 *  hardcode ตรงนี้ ∵ @Processor decorator ประเมินตอน class-def (อ่าน ConfigService ไม่ได้). */
const AHREFS_LIMITER = { max: 5, duration: 1000 } as const;

/** rows/req ของ per-page organic ที่ fan-out จาก top-pages (orchestration เอกสาร 03a §8). */
const PER_PAGE_ORGANIC_LIMIT = 30;

/** ทุก job ของ queue 'ahrefs' — แยกด้วย job.name (discriminator). */
type AhrefsJobData =
  | EnrichOrganicJobData
  | EnrichKeywordsJobData
  | TopPagesJobData
  | CompetitorsJobData
  | SerpOverviewJobData
  | KeywordIdeasJobData
  | BacklinksJobData;
type AhrefsJobResult =
  | EnrichmentSummary
  | KeywordOverviewSummary
  | TopPagesSummary
  | CompetitorsSummary
  | SerpOverviewSummary
  | KeywordIdeasSummary
  | BacklinksSummary;

/**
 * Consumer ของ queue 'ahrefs' — รันใน worker process แยกจาก api (เอกสาร 00 §4).
 * limiter กัน 429; คืน summary → BullMQ เก็บเป็น job.returnvalue ให้ api อ่านผ่าน
 * GET /projects/:id/ahrefs/enrich/:jobId. inject queue เดียวกันเพื่อ fan-out งานต่อ
 * (orchestration top-pages → per-page organic).
 */
@Processor('ahrefs', { limiter: AHREFS_LIMITER })
export class AhrefsProcessor extends WorkerHost {
  private readonly logger = new Logger(AhrefsProcessor.name);

  constructor(
    private readonly enrichment: EnrichmentService,
    @InjectQueue('ahrefs')
    private readonly queue: Queue<AhrefsJobData, AhrefsJobResult>,
  ) {
    super();
  }

  async process(job: Job<AhrefsJobData>): Promise<AhrefsJobResult> {
    this.logger.log(
      `ahrefs#${job.id} ${job.name} (project ${job.data.projectId})`,
    );
    // แยกตาม job.name — แต่ละ enqueue ตั้งชื่อให้ตรง flow (เอกสาร 03a §3/§4/§5/§6).
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
        return this.processTopPages(job.data as TopPagesJobData);
      case 'competitors':
        return this.enrichment.enrichCompetitors(
          job.data as CompetitorsJobData,
        );
      case 'serp-overview':
        return this.enrichment.fetchSerpOverview(
          job.data as SerpOverviewJobData,
        );
      case 'keyword-ideas':
        return this.enrichment.fetchKeywordIdeas(
          job.data as KeywordIdeasJobData,
        );
      case 'backlinks':
        return this.enrichment.fetchBacklinks(job.data as BacklinksJobData);
      default:
        throw new Error(`unknown ahrefs job '${job.name}'`);
    }
  }

  /**
   * top-pages + (option) orchestration: คัด top 20% แล้วถ้า enrichSelected=true → fan-out
   * งาน organic-keywords (mode=exact) ต่อรายหน้า (เอกสาร 03a §8 flow) ผ่าน queue เดิม.
   * ลูกแต่ละตัวผ่าน budget/cache/rate-limit เหมือนงานปกติ — กันงบบานเพราะ limiter+cache.
   */
  private async processTopPages(
    data: TopPagesJobData,
  ): Promise<TopPagesSummary> {
    const summary = await this.enrichment.selectTopPages(data);
    if (data.enrichSelected && summary.topPages.length > 0) {
      for (const page of summary.topPages) {
        const child: EnrichOrganicJobData = {
          projectId: data.projectId,
          domain: data.domain,
          country: data.country,
          limit: PER_PAGE_ORGANIC_LIMIT,
          cap: data.cap,
          target: page.url,
          mode: 'exact',
        };
        await this.queue.add('enrich-organic', child);
      }
      this.logger.log(
        `top-pages#${data.projectId} fan-out ${summary.topPages.length} per-page organic (exact)`,
      );
    }
    return summary;
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
