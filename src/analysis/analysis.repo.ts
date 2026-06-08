import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import {
  auditFindings,
  crawls,
  keywords,
  pageKeywords,
  pageLinks,
  pageSnapshots,
  pages,
  projects,
  seoScores,
} from '../db/schema';
import type { Severity } from './scoring';

/** 1 snapshot ที่ analysis ต้องใช้ (join pages → url/isIndexable).
 *  headings/paragraphs เป็น unknown ∵ JSON column อาจคืนมาเป็น string (driver-dependent)
 *  → runner coerce เป็นรูปจริงก่อนใช้. */
export interface SnapshotRow {
  snapshotId: number;
  pageId: number;
  url: string;
  isIndexable: boolean;
  httpStatus: number;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  headings: unknown;
  paragraphs: unknown;
  wordCount: number;
  robotsMeta: string | null;
  imagesTotal: number;
  imagesMissingAlt: number;
  lcpMs: number | null;
  clsX1000: number | null;
  inpMs: number | null;
}

/** สัญญาณระดับหน้า จาก ranking (primary keyword + traffic รวม). */
export interface PageSignals {
  primaryKeyword: string | null;
  /** position ดีสุด (min) ของ primary keyword ในหน้าต่าง recency — null ถ้าไม่มี ranking.
   *  expose ไว้ให้ [4] AI ใช้ตรงกับ primaryKeyword (กันการ re-lookup row ผิดด้วย .find). */
  position: number | null;
  pageTraffic: number;
}

/** row ที่จะ insert ลง audit_findings (runner เติมจาก Finding ของ scoring). */
export interface FindingInsert {
  projectId: number;
  pageId: number;
  crawlId: number;
  type: string;
  severity: Severity;
  impactScore: number;
  details: Record<string, unknown>;
}

export interface ScoreUpsert {
  snapshotId: number;
  keywordCoverage: number | null;
  healthScore: number;
  breakdown: unknown;
}

/** 1 แถว ranking ดิบ (page_keywords ⨝ keywords) ที่ป้อนเข้า aggregatePageSignals. */
export interface RankingRow {
  pageId: number;
  keyword: string;
  position: number | null;
  traffic: number | null;
  capturedAt: number; // epoch ms (0 = ไม่ทราบ)
}

/**
 * หน้าต่าง "ranking สด" ต่อหน้า: นับเฉพาะ page_keywords ที่ capture ภายใน N วันนับจาก capture
 * ล่าสุดของหน้านั้น. ∵ page_keywords เป็น append-only ไม่มี cleanup (เอกสาร 01 §2 — uq ไม่มี)
 * → keyword ที่ "หลุดอันดับ" ในรอบ enrich ถัด ๆ ไม่มี row ถอนออก จะค้างตลอดแล้วทำให้ Σ traffic
 * (pageTraffic) พองเกินจริง → impactScore เพี้ยน. หน้าต่างกว้างพอให้งาน enrich หลายโหมด
 * (domain + per-page exact) ในรอบเดียวกันสะสม coverage รวมกันได้ แต่ตัดของรอบเก่าทิ้ง.
 */
export const RANKING_RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * รวมสัญญาณ ranking ต่อหน้า (pure, ไม่มี I/O → unit test ได้): primary keyword (position
 * ดีสุด) + Σ traffic. ตัดแถวที่เก่ากว่าหน้าต่าง recency ของหน้านั้นทิ้งก่อน (กัน keyword churn
 * สะสม) แล้ว dedup เอา capture ล่าสุดต่อ (page|keyword).
 */
export function aggregatePageSignals(
  rows: RankingRow[],
  windowMs: number = RANKING_RECENCY_WINDOW_MS,
): Map<number, PageSignals> {
  const out = new Map<number, PageSignals>();
  if (rows.length === 0) return out;

  // 1) capture ล่าสุดต่อหน้า → ใช้กำหนดขอบ recency window ของหน้านั้น
  const maxByPage = new Map<number, number>();
  for (const r of rows) {
    const prev = maxByPage.get(r.pageId);
    if (prev == null || r.capturedAt > prev)
      maxByPage.set(r.pageId, r.capturedAt);
  }

  // 2) dedup เอาแถวล่าสุดต่อ (page|keyword) — เฉพาะที่อยู่ในหน้าต่าง (ตัด churn รอบเก่า)
  const latest = new Map<string, RankingRow>();
  for (const r of rows) {
    const cutoff = (maxByPage.get(r.pageId) ?? 0) - windowMs;
    if (r.capturedAt < cutoff) continue;
    const key = `${r.pageId}|${r.keyword}`;
    const prev = latest.get(key);
    if (!prev || r.capturedAt >= prev.capturedAt) latest.set(key, r);
  }

  // 3) aggregate ต่อหน้า: primary = position น้อยสุด, pageTraffic = Σ traffic
  const best = new Map<number, { keyword: string; position: number }>();
  for (const v of latest.values()) {
    const sig = out.get(v.pageId) ?? {
      primaryKeyword: null,
      position: null,
      pageTraffic: 0,
    };
    sig.pageTraffic += v.traffic ?? 0;
    out.set(v.pageId, sig);

    if (v.position != null) {
      const b = best.get(v.pageId);
      if (!b || v.position < b.position)
        best.set(v.pageId, { keyword: v.keyword, position: v.position });
    }
  }
  for (const [pageId, b] of best) {
    const sig = out.get(pageId)!;
    sig.primaryKeyword = b.keyword;
    sig.position = b.position; // ใช้ position ที่ชนะ (windowed min) ไม่ทิ้งให้ caller re-lookup
  }
  return out;
}

/**
 * AnalysisRepo — รวม Drizzle query ของ stage [3] Analysis (อ่าน crawl/enrich + เขียน
 * seo_scores/audit_findings). service ชั้นบน (AnalysisRunner / AnalysisService) ไม่ต้องรู้ SQL.
 * inject DB (token @Global จาก db.module) แบบเดียวกับ AhrefsRepo.
 */
@Injectable()
export class AnalysisRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** มี project นี้จริงไหม (ให้ producer ตอบ NOT_FOUND ก่อน enqueue). */
  async projectExists(projectId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * crawl ล่าสุด "ที่วิเคราะห์ได้" ของ project (ใช้เมื่อ caller ไม่ระบุ crawlId) — null ถ้ายัง
   * ไม่มี. ⚠️ ต้องกรอง status∈{done,partial} เท่านั้น: ถ้าเอา createdAt ล่าสุดเฉย ๆ จะคว้า
   * crawl ที่ยัง running (createCrawl เขียน row=running ทันที แต่ snapshot ยัง commit ไม่เสร็จ
   * — ช่อง race ถ่างขึ้นอีกตอน PSI ทำงาน 10-30s) หรือ failed (rollback แล้วไม่มี snapshot)
   * มาแทน crawl ดีรอบก่อน → analysis ได้ผลว่าง/เพี้ยน (เอกสาร 00 §4 / 04 §7).
   */
  async latestCrawlId(projectId: number): Promise<number | null> {
    const rows = await this.db
      .select({ id: crawls.id })
      .from(crawls)
      .where(
        and(
          eq(crawls.projectId, projectId),
          inArray(crawls.status, ['done', 'partial']),
        ),
      )
      .orderBy(desc(crawls.createdAt))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  /** snapshots ทุกหน้าใน 1 crawl (join pages เอา url + isIndexable). */
  async snapshotsForCrawl(crawlId: number): Promise<SnapshotRow[]> {
    const rows = await this.db
      .select({
        snapshotId: pageSnapshots.id,
        pageId: pageSnapshots.pageId,
        url: pages.url,
        isIndexable: pages.isIndexable,
        httpStatus: pageSnapshots.httpStatus,
        title: pageSnapshots.title,
        metaDescription: pageSnapshots.metaDescription,
        h1: pageSnapshots.h1,
        headings: pageSnapshots.headings,
        paragraphs: pageSnapshots.paragraphs,
        wordCount: pageSnapshots.wordCount,
        robotsMeta: pageSnapshots.robotsMeta,
        imagesTotal: pageSnapshots.imagesTotal,
        imagesMissingAlt: pageSnapshots.imagesMissingAlt,
        lcpMs: pageSnapshots.lcpMs,
        clsX1000: pageSnapshots.clsX1000,
        inpMs: pageSnapshots.inpMs,
      })
      .from(pageSnapshots)
      .innerJoin(pages, eq(pageSnapshots.pageId, pages.id))
      .where(eq(pageSnapshots.crawlId, crawlId));
    return rows;
  }

  /**
   * สัญญาณ ranking ต่อหน้า (primary keyword + traffic รวม) สำหรับ pageIds ที่ให้มา.
   * page_keywords เป็น append-only time-series (ไม่ผูก crawl เสมอ) → ตรรกะรวม/กรอง churn
   * อยู่ใน aggregatePageSignals (pure, มี recency window — ดู RANKING_RECENCY_WINDOW_MS).
   */
  async pageSignalsForCrawl(
    pageIds: number[],
  ): Promise<Map<number, PageSignals>> {
    if (pageIds.length === 0) return new Map<number, PageSignals>();

    const rows = await this.db
      .select({
        pageId: pageKeywords.pageId,
        keyword: keywords.keyword,
        position: pageKeywords.position,
        traffic: pageKeywords.traffic,
        capturedAt: pageKeywords.capturedAt,
      })
      .from(pageKeywords)
      .innerJoin(keywords, eq(pageKeywords.keywordId, keywords.id))
      .where(inArray(pageKeywords.pageId, pageIds));

    return aggregatePageSignals(
      rows.map((r) => ({
        pageId: r.pageId,
        keyword: r.keyword,
        position: r.position,
        traffic: r.traffic ?? 0,
        capturedAt: r.capturedAt?.getTime() ?? 0,
      })),
    );
  }

  /** จำนวนลิงก์ภายในที่ชี้ "เข้า" แต่ละหน้าใน crawl นี้ (group by toPageId). */
  async inboundInternalCountByPage(
    crawlId: number,
  ): Promise<Map<number, number>> {
    const rows = await this.db
      .select({
        toPageId: pageLinks.toPageId,
        count: sql<number>`count(*)`,
      })
      .from(pageLinks)
      .where(
        and(
          eq(pageLinks.crawlId, crawlId),
          eq(pageLinks.isInternal, true),
          isNotNull(pageLinks.toPageId),
        ),
      )
      .groupBy(pageLinks.toPageId);
    const out = new Map<number, number>();
    for (const r of rows)
      if (r.toPageId != null) out.set(r.toPageId, Number(r.count));
    return out;
  }

  /** ลบ findings เดิมของ crawl นี้ก่อน insert ใหม่ (rerun idempotent). */
  async clearFindingsForCrawl(
    projectId: number,
    crawlId: number,
  ): Promise<void> {
    await this.db
      .delete(auditFindings)
      .where(
        and(
          eq(auditFindings.projectId, projectId),
          eq(auditFindings.crawlId, crawlId),
        ),
      );
  }

  /** upsert seo_scores ต่อ snapshot (uq snapshot_id → rerun ทับค่าเดิม). */
  async upsertScore(input: ScoreUpsert): Promise<void> {
    const set = {
      keywordCoverage: input.keywordCoverage,
      healthScore: input.healthScore,
      breakdown: input.breakdown,
    };
    await this.db
      .insert(seoScores)
      .values({ snapshotId: input.snapshotId, ...set })
      .onDuplicateKeyUpdate({ set });
  }

  /** bulk insert audit_findings (status default 'open' จาก schema). */
  async insertFindings(rows: FindingInsert[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.insert(auditFindings).values(
      rows.map((r) => ({
        projectId: r.projectId,
        pageId: r.pageId,
        crawlId: r.crawlId,
        type: r.type,
        severity: r.severity,
        impactScore: r.impactScore,
        details: r.details,
      })),
    );
  }

  /* ---------- read endpoints (dashboard) ---------- */

  /** findings ของ project เรียงตาม impact (สูง→ต่ำ) + total สำหรับ pagination. */
  async listFindings(
    projectId: number,
    opts: { status?: string; type?: string; limit: number; offset: number },
  ): Promise<{ items: FindingListItem[]; total: number }> {
    const conds = [eq(auditFindings.projectId, projectId)];
    if (opts.status)
      conds.push(
        eq(
          auditFindings.status,
          opts.status as 'open' | 'in_progress' | 'fixed' | 'ignored',
        ),
      );
    if (opts.type) conds.push(eq(auditFindings.type, opts.type));
    const where = and(...conds);

    const items = await this.db
      .select({
        id: auditFindings.id,
        pageId: auditFindings.pageId,
        url: pages.url,
        crawlId: auditFindings.crawlId,
        type: auditFindings.type,
        severity: auditFindings.severity,
        impactScore: auditFindings.impactScore,
        status: auditFindings.status,
        details: auditFindings.details,
        detectedAt: auditFindings.detectedAt,
      })
      .from(auditFindings)
      .leftJoin(pages, eq(auditFindings.pageId, pages.id))
      .where(where)
      .orderBy(desc(auditFindings.impactScore), desc(auditFindings.detectedAt))
      .limit(opts.limit)
      .offset(opts.offset);

    const totalRows = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(auditFindings)
      .where(where);

    return { items: items, total: Number(totalRows[0].n) };
  }

  /** seo_scores ของ crawl (ระบุ หรือ ล่าสุด) join page url. */
  async listScores(
    projectId: number,
    crawlId?: number,
  ): Promise<ScoreListItem[]> {
    const cid = crawlId ?? (await this.latestCrawlId(projectId));
    if (cid == null) return [];
    const rows = await this.db
      .select({
        snapshotId: seoScores.snapshotId,
        pageId: pageSnapshots.pageId,
        url: pages.url,
        keywordCoverage: seoScores.keywordCoverage,
        healthScore: seoScores.healthScore,
        breakdown: seoScores.breakdown,
      })
      .from(seoScores)
      .innerJoin(pageSnapshots, eq(seoScores.snapshotId, pageSnapshots.id))
      .innerJoin(pages, eq(pageSnapshots.pageId, pages.id))
      .where(eq(pageSnapshots.crawlId, cid))
      .orderBy(desc(seoScores.healthScore));
    return rows;
  }
}

export interface FindingListItem {
  id: number;
  pageId: number | null;
  url: string | null;
  crawlId: number | null;
  type: string;
  severity: Severity;
  impactScore: number;
  status: string;
  details: unknown;
  detectedAt: Date;
}

export interface ScoreListItem {
  snapshotId: number;
  pageId: number;
  url: string;
  keywordCoverage: number | null;
  healthScore: number | null;
  breakdown: unknown;
}
