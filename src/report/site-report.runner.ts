import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AhrefsRepo } from '../ahrefs/ahrefs.repo';
import { EnrichmentService } from '../ahrefs/enrichment.service';
import type { SiteEnrichJobData } from '../ahrefs/enrichment.service';
import { AiConfigRepo } from '../ai/ai-config.repo';
import { mkModel } from '../ai/llm/openrouter';
import type { OpenRouterConn } from '../ai/llm/openrouter';
import { renderSkills } from '../ai/skills/render';
import { WhoisService } from './whois.service';
import { SiteReportRepo } from './site-report.repo';
import { analyzeSite } from './site-analysis';
import type { SiteAnalysis, SiteMetricsContext } from './site-analysis';
import type { SiteReportJobData, SiteReportSummary } from './site-report.types';

const SITE_COMPETITORS_LIMIT = 12;
const TOP_KEYWORDS_LIMIT = 50;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

const msgOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * SiteReportRunner (worker) — orchestrate รายงานเว็บเต็ม (apnth.com template) ตามลำดับ:
 *   1) enrichSite (Ahrefs): DR/UR/BL/refdomains → backlink_snapshots + competitors
 *   2) LW (refdomains-history) + SS (spam estimate) — flag-gated + best-effort
 *   3) WHOIS (RDAP): registrar/วันจด → AGE  + meta description หน้าแรก
 *   4) อ่าน metric ที่ enrich แล้วจาก DB → ประกอบ context
 *   5) AI analysis (จุดแข็ง/จุดอ่อน/คำแนะนำ/timeline) — best-effort, บันทึก token ลง ai_runs
 *   6) upsert site_reports (รายงานล่าสุด)
 * ทุกขั้นเสริม (LW/SS/AI/WHOIS) เป็น best-effort: ล้ม → ค่านั้น null โดยรายงานยังเซฟ metric หลัก.
 */
@Injectable()
export class SiteReportRunner {
  private readonly logger = new Logger(SiteReportRunner.name);

  constructor(
    private readonly enrich: EnrichmentService,
    private readonly whois: WhoisService,
    private readonly ahrefsRepo: AhrefsRepo,
    private readonly repo: SiteReportRepo,
    private readonly aiConfig: AiConfigRepo,
    private readonly config: ConfigService,
  ) {}

  async generate(job: SiteReportJobData): Promise<SiteReportSummary> {
    const siteJob: SiteEnrichJobData = {
      projectId: job.projectId,
      domain: job.domain,
      country: job.country,
      cap: job.cap,
      competitorsLimit: job.competitorsLimit,
    };

    // 1) Ahrefs ระดับโดเมน — DR/UR/BL/refdomains (→ backlink_snapshots) + competitors
    const site = await this.enrich.enrichSite(siteJob);
    let unitsSpent = site.unitsSpent;

    // 2) LW (refdomains-history) + SS (spam) — flag-gated, best-effort (อาจไม่อยู่ใน plan Lite)
    let refdomainsNew: number | null = null;
    let refdomainsLost: number | null = null;
    if (this.config.get<boolean>('AHREFS_REFDOMAINS_HISTORY_ENABLED')) {
      try {
        const h = await this.enrich.fetchRefdomainsHistory(siteJob);
        refdomainsNew = h.refdomainsNew;
        refdomainsLost = h.refdomainsLost;
        unitsSpent += h.unitsSpent;
      } catch (err) {
        this.logger.warn(
          `refdomains-history ${job.domain} failed: ${msgOf(err)}`,
        );
      }
    }
    let spamScore: number | null = null;
    if (this.config.get<boolean>('SITE_SPAM_ESTIMATE_ENABLED')) {
      try {
        const s = await this.enrich.fetchSpamEstimate(siteJob);
        spamScore = s.spamScore;
        unitsSpent += s.unitsSpent;
      } catch (err) {
        this.logger.warn(`spam estimate ${job.domain} failed: ${msgOf(err)}`);
      }
    }
    // AI mentions: brand-radar/ai-responses ไม่อยู่ใน plan ปัจจุบัน (เอกสาร 03a เว้นไว้) → null.
    // flag สำรองไว้ wire ภายหลังเมื่อ plan รองรับ — เปิดตอนนี้แค่ log เตือน (ค่าคง "—").
    const aiMentions: number | null = null;
    if (this.config.get<boolean>('AHREFS_BRANDRADAR_ENABLED'))
      this.logger.warn(
        'AHREFS_BRANDRADAR_ENABLED=true แต่ brand-radar ยังไม่ wire (ไม่อยู่ใน plan) → AI mentions=—',
      );

    // 3) WHOIS (RDAP) — registrar/วันจด + meta หน้าแรก
    const who = await this.whois.lookup(job.domain);
    const meta = await this.repo.getHomepageMeta(job.projectId);

    // 4) อ่าน metric ที่ enrich แล้วจาก DB
    const [backlinks, organic, competitors, topKeywords] = await Promise.all([
      this.ahrefsRepo.getDomainBacklinks(job.projectId),
      this.ahrefsRepo.getSiteOrganic(job.projectId),
      this.ahrefsRepo.getSiteCompetitors(job.projectId, SITE_COMPETITORS_LIMIT),
      this.ahrefsRepo.getTopKeywords(job.projectId, TOP_KEYWORDS_LIMIT),
    ]);
    const ageYears = who.createdAt
      ? Math.max(
          0,
          Math.floor((Date.now() - who.createdAt.getTime()) / MS_PER_YEAR),
        )
      : null;

    const ctx: SiteMetricsContext = {
      domain: job.domain,
      country: job.country,
      registrar: who.registrar,
      ageYears,
      metaDescription: meta?.metaDescription ?? null,
      domainRating: backlinks?.domainRating ?? null,
      urlRating: backlinks?.urlRating ?? null,
      backlinks: backlinks?.backlinks ?? null,
      referringDomains: backlinks?.referringDomains ?? null,
      refdomainsNew,
      refdomainsLost,
      spamScore,
      aiMentions,
      organicTraffic: organic.traffic,
      organicValue: organic.value,
      organicKeywords: organic.keywords,
      competitors: competitors.domains,
      topKeywords: topKeywords.map((k) => ({
        keyword: k.keyword,
        position: k.position,
        volume: k.volume,
      })),
    };

    // 5) AI analysis (best-effort) — ไม่มี OPENROUTER key/ล้ม → analysis=null (รายงานยังเซฟ metric)
    let analysis: SiteAnalysis | null = null;
    let aiAnalyzed = false;
    try {
      const conn: OpenRouterConn = {
        apiKey: this.config.get<string>('OPENROUTER_API_KEY'),
        baseURL: this.config.get<string>('OPENROUTER_BASE_URL')!,
        siteUrl: this.config.get<string>('OPENROUTER_SITE_URL')!,
        appTitle: this.config.get<string>('OPENROUTER_APP_TITLE')!,
        timeoutMs: this.config.get<number>('OPENROUTER_TIMEOUT_MS'),
      };
      const cfg = await this.aiConfig.resolveModelCfg(
        job.projectId,
        'reasoner',
      );
      const skills = renderSkills(
        await this.aiConfig.resolveSkillsForNode(job.projectId, 'site_report'),
      );
      const out = await analyzeSite(mkModel(cfg, conn), ctx, skills);
      analysis = out.analysis;
      aiAnalyzed = true;
      await this.repo.recordAiRun({
        projectId: job.projectId,
        userId: job.userId,
        models: await this.aiConfig.resolveModelMap(job.projectId),
        inputTokens: out.tokensIn,
        outputTokens: out.tokensOut,
      });
    } catch (err) {
      this.logger.warn(`site analysis ${job.domain} failed: ${msgOf(err)}`);
    }

    // 6) upsert site_reports
    await this.repo.upsert({
      projectId: job.projectId,
      registrar: who.registrar,
      domainCreatedAt: who.createdAt,
      metaDescription: meta?.metaDescription ?? null,
      refdomainsNew,
      refdomainsLost,
      spamScore,
      aiMentions,
      analysis,
    });

    const summary: SiteReportSummary = {
      projectId: job.projectId,
      domain: job.domain,
      domainRating: backlinks?.domainRating ?? null,
      backlinks: backlinks?.backlinks ?? null,
      registrar: who.registrar,
      aiAnalyzed,
      unitsSpent,
    };
    this.logger.log(
      `site-report#${job.projectId} ${job.domain} → DR=${summary.domainRating} BL=${summary.backlinks} registrar=${who.registrar ?? '—'} ai=${aiAnalyzed} units=${unitsSpent}`,
    );
    return summary;
  }
}
