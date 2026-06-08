import { Injectable, Logger } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/http';
import { AnalysisRepo } from './analysis.repo';
import type { FindingInsert, PageSignals, SnapshotRow } from './analysis.repo';
import { detectFindings, healthScore, keywordCoverage } from './scoring';
import type { Headings, SnapshotView } from './scoring';

/** parse JSON ถ้าเป็น string (driver บางตัวคืน JSON column เป็น text) — null ถ้าพัง. */
function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** บังคับให้เป็น string[] (กรองตัวที่ไม่ใช่ string) — null ถ้าไม่ใช่ array. */
function toStringArray(v: unknown): string[] | null {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : null;
}

/** coerce ค่า headings (object หรือ JSON string) เป็นรูป Headings — null ถ้าไม่ใช่. */
function toHeadings(v: unknown): Headings | null {
  const o = parseJson(v);
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const h = o as Record<string, unknown>;
  return {
    h1: toStringArray(h.h1) ?? [],
    h2: toStringArray(h.h2) ?? [],
    h3: toStringArray(h.h3) ?? [],
  };
}

/** payload ของ job 'analyze-crawl' (queue 'analysis') — producer เตรียมให้. */
export interface AnalyzeCrawlJobData {
  projectId: number;
  crawlId?: number; // ไม่ระบุ → ใช้ crawl ล่าสุดของ project
}

/** สรุปผล analyze — เก็บเป็น job.returnvalue ให้ api อ่านผ่าน GET status. */
export interface AnalysisSummary {
  projectId: number;
  crawlId: number;
  pagesAnalyzed: number;
  /**
   * จำนวนหน้าที่มี ranking signal สด (จาก flow [2] Ahrefs ผ่าน page_keywords). 0 ทั้งที่
   * pagesAnalyzed>0 = handoff [2]→[3] ขาด — Ahrefs ยังไม่รัน หรือ url_hash ไม่ match
   * (ดู crawler.repo key หน้าด้วย finalUrl). เปิดให้สังเกตได้แทนล้มเหลวเงียบ ๆ.
   */
  pagesWithRanking: number;
  scoresUpserted: number;
  findingsCreated: number;
  byType: Record<string, number>;
}

/**
 * AnalysisRunner — stage [3] (เอกสาร 04 §7): อ่าน snapshots ของ crawl + สัญญาณ ranking
 * + กราฟลิงก์ภายใน → คำนวณ seo_scores + audit_findings (โค้ดล้วน, ไม่มี AI). รันใน worker
 * เท่านั้น (เอกสาร 00 §4) ผ่าน AnalysisProcessor. logic การให้คะแนนอยู่ใน scoring.ts (pure).
 */
@Injectable()
export class AnalysisRunner {
  private readonly logger = new Logger(AnalysisRunner.name);

  constructor(private readonly repo: AnalysisRepo) {}

  async analyzeCrawl(job: AnalyzeCrawlJobData): Promise<AnalysisSummary> {
    const crawlId =
      job.crawlId ?? (await this.repo.latestCrawlId(job.projectId));
    if (crawlId == null)
      throw new AppException(
        ErrorCode.ANALYSIS_NO_CRAWL,
        `project ${job.projectId} ยังไม่มี crawl ให้วิเคราะห์`,
      );

    const snapshots = await this.repo.snapshotsForCrawl(crawlId);
    // crawl done/partial ต้องมี snapshot ≥1 เสมอ ∴ ว่าง = crawl ยังไม่เสร็จ/ล้ม หรือ caller
    // ส่ง crawlId ผิด → โยนแทนคืน pagesAnalyzed=0 เงียบ ๆ (กันผลลวงว่า "วิเคราะห์สำเร็จ 0 หน้า").
    if (snapshots.length === 0)
      throw new AppException(
        ErrorCode.ANALYSIS_NO_CRAWL,
        `crawl ${crawlId} ไม่มี snapshot ให้วิเคราะห์ (crawl ยังไม่เสร็จ/ล้ม หรือ crawlId ไม่ถูกต้อง)`,
      );

    const signals = await this.repo.pageSignalsForCrawl(
      snapshots.map((s) => s.pageId),
    );
    const inbound = await this.repo.inboundInternalCountByPage(crawlId);

    // handoff [2]→[3]: signals.size = หน้าที่มี ranking สด. 0 = Ahrefs ยังไม่รัน/ไม่ match
    // → เตือน (ไม่ throw — analysis on-page ทำงานได้แม้ไม่มี ranking) แทนล้มเหลวเงียบ ๆ.
    const pagesWithRanking = signals.size;
    if (pagesWithRanking === 0)
      this.logger.warn(
        `analyze#${job.projectId} crawl=${crawlId}: ไม่มี ranking signal เลย ` +
          `(page_keywords ว่าง) — flow [2] Ahrefs ยังไม่รัน หรือ url_hash ไม่ match. ` +
          `keywordCoverage จะเป็น null + impact ไม่ถ่วง traffic ทุกหน้า.`,
      );

    const findings: FindingInsert[] = [];
    let scoresUpserted = 0;
    // orphan ต้องมี link graph ข้ามหน้า → ส่งให้ detectFindings รู้ว่า crawl นี้กี่หน้า
    // (single-URL → false = ไม่ตรวจ orphan, กัน false-positive; ดู scoring.DetectContext).
    const multiPage = snapshots.length > 1;

    for (const snap of snapshots) {
      const view = this.toView(snap, signals, inbound);
      const cov = keywordCoverage(view);
      const health = healthScore(view);

      await this.repo.upsertScore({
        snapshotId: snap.snapshotId,
        keywordCoverage: cov.score,
        healthScore: health.score,
        breakdown: { coverage: cov.breakdown, health: health.breakdown },
      });
      scoresUpserted += 1;

      for (const f of detectFindings(view, { multiPage }))
        findings.push({
          projectId: job.projectId,
          pageId: snap.pageId,
          crawlId,
          type: f.type,
          severity: f.severity,
          impactScore: f.impactScore,
          details: f.details,
        });
    }

    // rerun idempotent: ลบ findings เดิมของ crawl นี้ก่อน แล้ว insert ชุดใหม่
    await this.repo.clearFindingsForCrawl(job.projectId, crawlId);
    await this.repo.insertFindings(findings);

    const byType: Record<string, number> = {};
    for (const f of findings) byType[f.type] = (byType[f.type] ?? 0) + 1;

    const summary: AnalysisSummary = {
      projectId: job.projectId,
      crawlId,
      pagesAnalyzed: snapshots.length,
      pagesWithRanking,
      scoresUpserted,
      findingsCreated: findings.length,
      byType,
    };
    this.logger.log(
      `analyze#${job.projectId} crawl=${crawlId} pages=${snapshots.length} ` +
        `ranking=${pagesWithRanking} scores=${scoresUpserted} findings=${findings.length}`,
    );
    return summary;
  }

  /** ประกอบ SnapshotView (input ของ scoring) จาก snapshot row + map สัญญาณ. */
  private toView(
    snap: SnapshotRow,
    signals: Map<number, PageSignals>,
    inbound: Map<number, number>,
  ): SnapshotView {
    const sig = signals.get(snap.pageId) ?? {
      primaryKeyword: null,
      pageTraffic: 0,
    };
    return {
      url: snap.url,
      httpStatus: snap.httpStatus,
      title: snap.title,
      metaDescription: snap.metaDescription,
      h1: snap.h1,
      headings: toHeadings(snap.headings),
      paragraphs: toStringArray(parseJson(snap.paragraphs)),
      wordCount: snap.wordCount,
      robotsMeta: snap.robotsMeta,
      isIndexable: snap.isIndexable,
      imagesTotal: snap.imagesTotal,
      imagesMissingAlt: snap.imagesMissingAlt,
      lcpMs: snap.lcpMs,
      clsX1000: snap.clsX1000,
      inpMs: snap.inpMs,
      primaryKeyword: sig.primaryKeyword,
      pageTraffic: sig.pageTraffic,
      inboundInternalLinks: inbound.get(snap.pageId) ?? 0,
    };
  }
}
