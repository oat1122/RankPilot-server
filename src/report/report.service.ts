import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppException, ErrorCode } from '../common/http';
import { withTimeout } from '../common/with-timeout';
import { AhrefsRepo } from '../ahrefs/ahrefs.repo';
import type { ProjectRow } from '../ahrefs/ahrefs.repo';
import { SiteReportRepo } from './site-report.repo';
import type { SiteReportJobData, SiteReportSummary } from './site-report.types';

const DEFAULT_COMPETITORS_LIMIT = 10;
const SITE_COMPETITORS_DISPLAY_LIMIT = 12;
const TOP_KEYWORDS_LIMIT = 50;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
const QUEUE_ERROR_LOG_THROTTLE_MS = 10_000;

type ReportQueue = Queue<SiteReportJobData, SiteReportSummary>;

/**
 * ReportService (api side) — บางตามกฎ api ≠ worker (เอกสาร 00 §4): enqueue งานสร้างรายงานเข้า
 * queue 'report' + อ่านรายงาน (DB-read) ประกอบจาก AhrefsRepo (metric core) + SiteReportRepo
 * (WHOIS/meta/LW/SS/AI/analysis). การยิง Ahrefs/AI จริงทำใน worker (ReportProcessor).
 */
@Injectable()
export class ReportService implements OnModuleInit {
  private readonly logger = new Logger(ReportService.name);
  private lastQueueErrorLogAt = 0;

  constructor(
    @InjectQueue('report') private readonly queue: ReportQueue,
    private readonly config: ConfigService,
    private readonly ahrefsRepo: AhrefsRepo,
    private readonly repo: SiteReportRepo,
  ) {}

  onModuleInit() {
    // listener 'error' กัน Redis ล่ม → unhandled 'error' ล้ม process (เหมือน EnrichService).
    this.queue.on('error', (err: Error) => {
      const now = Date.now();
      if (now - this.lastQueueErrorLogAt < QUEUE_ERROR_LOG_THROTTLE_MS) return;
      this.lastQueueErrorLogAt = now;
      this.logger.warn(
        `report queue error: ${err.message || 'unknown'} — Redis (REDIS_URL) ใช้งานได้อยู่ไหม?`,
      );
    });
  }

  /** enqueue สร้างรายงานเว็บเต็ม (job 'site-report') — worker orchestrate Ahrefs+WHOIS+meta+AI. */
  async enqueue(projectId: number, userId?: number) {
    const project = await this.loadProject(projectId);
    const data: SiteReportJobData = {
      projectId,
      domain: project.domain,
      country:
        project.country ?? this.config.get<string>('AHREFS_DEFAULT_COUNTRY')!,
      cap:
        project.monthlyUnitBudget ??
        this.config.get<number>('AHREFS_MONTHLY_UNIT_BUDGET')!,
      competitorsLimit: DEFAULT_COMPETITORS_LIMIT,
      userId: userId ?? null,
    };
    const timeoutMs =
      this.config.get<number>('QUEUE_ENQUEUE_TIMEOUT_MS') ?? 5000;
    try {
      const job = await withTimeout(
        this.queue.add('site-report', data),
        timeoutMs,
      );
      return { jobId: job.id, projectId, status: 'queued' as const };
    } catch (err) {
      const reason =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      this.logger.error(`enqueue report failed: ${reason}`);
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'ตั้งคิวสร้างรายงานไม่สำเร็จ (queue ไม่พร้อม) — โปรดลองใหม่อีกครั้ง',
      );
    }
  }

  /** สถานะ job รายงาน (queue 'report') + สรุปผลเมื่อ completed. */
  async status(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job)
      throw new AppException(
        ErrorCode.AHREFS_JOB_NOT_FOUND,
        `report job ${jobId} not found`,
      );
    const state = await job.getState();
    return {
      jobId: job.id,
      name: job.name,
      state,
      result: state === 'completed' ? job.returnvalue : null,
      failedReason: state === 'failed' ? job.failedReason : null,
    };
  }

  /**
   * รายงานเว็บเต็ม (DB-read) — ประกอบจาก backlink_snapshots (DR/UR/BL/refdomains) + organic +
   * competitors + top keyword (AhrefsRepo) + site_reports (WHOIS/meta/LW/SS/AI/analysis). AGE
   * คำนวณจากวันจด. ค่าที่ยังไม่มี = null → FE แสดง "—".
   */
  async getReport(projectId: number) {
    const project = await this.loadProject(projectId);
    const [backlinks, organic, competitors, keywords, report] =
      await Promise.all([
        this.ahrefsRepo.getDomainBacklinks(projectId),
        this.ahrefsRepo.getSiteOrganic(projectId),
        this.ahrefsRepo.getSiteCompetitors(
          projectId,
          SITE_COMPETITORS_DISPLAY_LIMIT,
        ),
        this.ahrefsRepo.getTopKeywords(projectId, TOP_KEYWORDS_LIMIT),
        this.repo.get(projectId),
      ]);
    const createdAt = report?.domainCreatedAt ?? null;
    const ageYears = createdAt
      ? Math.max(
          0,
          Math.floor((Date.now() - createdAt.getTime()) / MS_PER_YEAR),
        )
      : null;
    return {
      domain: project.domain,
      registrar: report?.registrar ?? null,
      domainCreatedAt: createdAt ? createdAt.toISOString() : null,
      ageYears,
      metaDescription: report?.metaDescription ?? null,
      metrics: {
        domainRating: backlinks?.domainRating ?? null,
        urlRating: backlinks?.urlRating ?? null,
        backlinks: backlinks?.backlinks ?? null,
        referringDomains: backlinks?.referringDomains ?? null,
        refdomainsNew: report?.refdomainsNew ?? null,
        refdomainsLost: report?.refdomainsLost ?? null,
        spamScore: report?.spamScore ?? null,
        aiMentions: report?.aiMentions ?? null,
        capturedAt: backlinks?.capturedAt
          ? backlinks.capturedAt.toISOString()
          : null,
      },
      organic,
      competitors: competitors.domains,
      competitorsCount: competitors.total,
      keywords,
      analysis: report?.analysis ?? null,
      generatedAt: report?.generatedAt
        ? report.generatedAt.toISOString()
        : null,
    };
  }

  /** โหลด project (domain/country/budget) — โยน NOT_FOUND ถ้าไม่มี. */
  private async loadProject(projectId: number): Promise<ProjectRow> {
    const project = await this.ahrefsRepo.getProject(projectId);
    if (!project)
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `project ${projectId} not found`,
      );
    return project;
  }
}
