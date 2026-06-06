import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppException, ErrorCode } from '../common/http';
import { withTimeout } from '../common/with-timeout';
import { AhrefsRepo } from '../ahrefs/ahrefs.repo';
import type { ProjectRow } from '../ahrefs/ahrefs.repo';
import { BudgetGuard } from '../ahrefs/budget/budget.guard';
import { currentPeriod } from '../ahrefs/budget/period';
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
import type {
  CreateEnrichDto,
  EnrichKeywordsDto,
  TopPagesDto,
  CompetitorsDto,
  SerpOverviewDto,
  KeywordIdeasDto,
  BacklinksDto,
} from './dto/create-enrich.dto';

/** ทุก job ของ queue 'ahrefs' (แยกด้วย job.name) — producer/consumer ใช้ชุดเดียวกัน. */
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
type EnrichQueue = Queue<AhrefsJobData, AhrefsJobResult>;

/** throttle log queue 'error' — ioredis retry ถี่ตอน Redis ล่ม ไม่งั้น log ท่วม */
const QUEUE_ERROR_LOG_THROTTLE_MS = 10_000;
/** default rows/request — Lite จริง ~10 rows (เอกสาร 03 §0) */
const DEFAULT_LIMIT = 10;
/** default หน้าที่ดึงจาก top-pages ก่อนคัด top 20% (เอกสาร 03a §4.2). */
const DEFAULT_TOPPAGES_LIMIT = 100;
/** default limit ของ Tier 2-3 ที่เหลือ (competitors/serp/ideas — เอกสาร 03a §4.3/§5). */
const DEFAULT_COMPETITORS_LIMIT = 10;
const DEFAULT_SERP_LIMIT = 10;
const DEFAULT_IDEAS_LIMIT = 50;

/**
 * EnrichService (api side) — บางตามกฎ api ≠ worker (เอกสาร 00 §4): โหลด project,
 * resolve country/cap แล้วตั้งงานเข้า queue 'ahrefs'. การยิง Ahrefs จริงทำใน worker.
 */
@Injectable()
export class EnrichService implements OnModuleInit {
  private readonly logger = new Logger(EnrichService.name);
  private lastQueueErrorLogAt = 0;

  constructor(
    @InjectQueue('ahrefs') private readonly queue: EnrichQueue,
    private readonly config: ConfigService,
    private readonly repo: AhrefsRepo,
    private readonly budget: BudgetGuard,
  ) {}

  onModuleInit() {
    // ต้องมี listener 'error' มิฉะนั้น Redis ล่ม → unhandled 'error' ล้มทั้ง process
    // (เหตุผลเดียวกับ CrawlService) + throttle กัน log ท่วมตอน retry ถี่.
    this.queue.on('error', (err: Error) => {
      const now = Date.now();
      if (now - this.lastQueueErrorLogAt < QUEUE_ERROR_LOG_THROTTLE_MS) return;
      this.lastQueueErrorLogAt = now;
      const code = (err as { code?: string }).code;
      const detail = [err.name, code, err.message].filter(Boolean).join(' ');
      this.logger.warn(
        `ahrefs queue error: ${detail || 'unknown'} — Redis (REDIS_URL) ใช้งานได้อยู่ไหม?`,
      );
    });
  }

  /** enqueue organic-keywords ของ domain (job 'enrich-organic' — เอกสาร 03a §3). */
  async enqueue(projectId: number, dto: CreateEnrichDto) {
    const project = await this.loadProject(projectId);
    const data: EnrichOrganicJobData = {
      projectId,
      domain: project.domain,
      country: this.countryOf(project, dto.country),
      limit: dto.limit ?? DEFAULT_LIMIT,
      cap: this.capOf(project),
    };
    return this.addJob('enrich-organic', data, projectId);
  }

  /** enqueue keywords-explorer/overview (job 'enrich-keywords' — เอกสาร 03a §4.1). */
  async enqueueKeywords(projectId: number, dto: EnrichKeywordsDto) {
    const project = await this.loadProject(projectId);
    const data: EnrichKeywordsJobData = {
      projectId,
      country: this.countryOf(project, dto.country),
      keywords: dto.keywords,
      cap: this.capOf(project),
    };
    return this.addJob('enrich-keywords', data, projectId);
  }

  /** enqueue site-explorer/top-pages (job 'top-pages' — เอกสาร 03a §4.2). */
  async enqueueTopPages(projectId: number, dto: TopPagesDto) {
    const project = await this.loadProject(projectId);
    const data: TopPagesJobData = {
      projectId,
      domain: project.domain,
      country: this.countryOf(project, dto.country),
      limit: dto.limit ?? DEFAULT_TOPPAGES_LIMIT,
      cap: this.capOf(project),
      enrichSelected: dto.enrichSelected ?? false, // true → worker fan-out per-page organic
    };
    return this.addJob('top-pages', data, projectId);
  }

  /** enqueue organic-competitors (job 'competitors' — เอกสาร 03a §4.3). */
  async enqueueCompetitors(projectId: number, dto: CompetitorsDto) {
    const project = await this.loadProject(projectId);
    const data: CompetitorsJobData = {
      projectId,
      domain: project.domain,
      country: this.countryOf(project, dto.country),
      limit: dto.limit ?? DEFAULT_COMPETITORS_LIMIT,
      cap: this.capOf(project),
    };
    return this.addJob('competitors', data, projectId);
  }

  /** enqueue serp-overview ของ 1 keyword (job 'serp-overview' — เอกสาร 03a §5). */
  async enqueueSerp(projectId: number, dto: SerpOverviewDto) {
    const project = await this.loadProject(projectId);
    const data: SerpOverviewJobData = {
      projectId,
      keyword: dto.keyword,
      country: this.countryOf(project, dto.country),
      limit: dto.limit ?? DEFAULT_SERP_LIMIT,
      cap: this.capOf(project),
    };
    return this.addJob('serp-overview', data, projectId);
  }

  /** enqueue matching/related-terms (job 'keyword-ideas' — เอกสาร 03a §5). */
  async enqueueIdeas(projectId: number, dto: KeywordIdeasDto) {
    const project = await this.loadProject(projectId);
    const data: KeywordIdeasJobData = {
      projectId,
      seed: dto.seed,
      country: this.countryOf(project, dto.country),
      limit: dto.limit ?? DEFAULT_IDEAS_LIMIT,
      cap: this.capOf(project),
      mode: dto.mode ?? 'matching',
    };
    return this.addJob('keyword-ideas', data, projectId);
  }

  /** enqueue site-explorer metrics/DR/backlinks (job 'backlinks' — เอกสาร 03a §6). */
  async enqueueBacklinks(projectId: number, dto: BacklinksDto) {
    const project = await this.loadProject(projectId);
    const data: BacklinksJobData = {
      projectId,
      domain: project.domain,
      country: this.countryOf(project, dto.country),
      cap: this.capOf(project),
    };
    return this.addJob('backlinks', data, projectId);
  }

  async status(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job)
      throw new AppException(
        ErrorCode.AHREFS_JOB_NOT_FOUND,
        `ahrefs job ${jobId} not found`,
      );
    const state = await job.getState();
    return {
      jobId: job.id,
      name: job.name, // 'enrich-organic' | 'enrich-keywords' | 'top-pages'
      state, // waiting | active | completed | failed | delayed
      result: state === 'completed' ? job.returnvalue : null,
      failedReason: state === 'failed' ? job.failedReason : null,
    };
  }

  async budgetStatus(projectId: number) {
    const project = await this.loadProject(projectId);
    const period = currentPeriod();
    const cap = this.capOf(project);
    const unitsSpent = await this.budget.spent(projectId, period);
    return {
      projectId,
      period,
      unitsSpent,
      cap,
      remaining: Math.max(cap - unitsSpent, 0),
    };
  }

  /** โหลด project (domain/country/budget) — โยน NOT_FOUND ถ้าไม่มี. */
  private async loadProject(projectId: number): Promise<ProjectRow> {
    const project = await this.repo.getProject(projectId);
    if (!project) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `project ${projectId} not found`,
      );
    }
    return project;
  }

  /** เพดาน units/เดือนของโปรเจค (fallback = ค่า env ระดับ workspace). */
  private capOf(project: ProjectRow): number {
    return (
      project.monthlyUnitBudget ??
      this.config.get<number>('AHREFS_MONTHLY_UNIT_BUDGET')!
    );
  }

  /** country ที่ใช้ยิง Ahrefs: override (body) → project → env default. */
  private countryOf(project: ProjectRow, override?: string): string {
    return (
      override ??
      project.country ??
      this.config.get<string>('AHREFS_DEFAULT_COUNTRY')!
    );
  }

  /**
   * add งานเข้า queue 'ahrefs' พร้อม timeout — ตอน Redis ล่ม queue.add() ค้าง (offline-queue)
   * ไม่ reject เอง → ตอบ 503 เร็ว ๆ แทนปล่อย request ค้างจน client abort (เอกสาร 00 §4).
   */
  private async addJob(
    name:
      | 'enrich-organic'
      | 'enrich-keywords'
      | 'top-pages'
      | 'competitors'
      | 'serp-overview'
      | 'keyword-ideas'
      | 'backlinks',
    data: AhrefsJobData,
    projectId: number,
  ) {
    const timeoutMs =
      this.config.get<number>('QUEUE_ENQUEUE_TIMEOUT_MS') ?? 5000;
    try {
      const job = await withTimeout(this.queue.add(name, data), timeoutMs);
      return { jobId: job.id, projectId, status: 'queued' as const };
    } catch (err) {
      const reason =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      this.logger.error(`enqueue ahrefs '${name}' failed: ${reason}`);
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'ตั้งคิว Ahrefs ไม่สำเร็จ (queue ไม่พร้อม) — โปรดลองใหม่อีกครั้ง',
      );
    }
  }
}
