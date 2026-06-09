import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
  sql,
} from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import {
  auditFindings,
  backlinkSnapshots,
  contentGaps,
  crawls,
  keywords,
  pageImages,
  pageKeywords,
  pageLinks,
  pageSnapshots,
  pages,
  projects,
  seoScores,
  serpResults,
} from '../db/schema';

/** ตัวเลือก list pages — crawl ที่เลือก (ไม่ส่ง = ล่าสุด) + paging + ค้นหา url/title. */
export interface ListPagesOptions {
  crawlId?: number;
  limit: number;
  offset: number;
  search?: string;
}

/**
 * PagesRepo — read-only: list หน้าจาก crawl ที่เลือก/ล่าสุด + รายละเอียดหน้าเดียว
 * (snapshot + score + ranking + links + images + findings). write path อยู่ที่ worker (CrawlerRepo).
 * inject DB token (@Global). scope ด้วย projectId ทุก query (multi-tenant — guard เช็คเจ้าของแล้ว).
 */
@Injectable()
export class PagesRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** crawl ล่าสุดที่มีผล (done/partial) ของ project — เหมือน analysis.repo.latestCrawlId. */
  private async latestCrawlId(projectId: number): Promise<number | null> {
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

  async listByProject(projectId: number, opts: ListPagesOptions) {
    const cid = opts.crawlId ?? (await this.latestCrawlId(projectId));
    if (cid == null)
      return {
        items: [],
        total: 0,
        limit: opts.limit,
        offset: opts.offset,
        crawlId: null,
      };

    // หนึ่งหน้าอาจมีหลาย snapshot ใน crawl เดียว (page_snapshots ไม่มี unique (crawl_id,page_id))
    // → เลือก snapshot ล่าสุดต่อหน้า = MAX(id) GROUP BY page_id ภายใน crawl ที่เลือก
    // กัน pageId ซ้ำ (React duplicate key) + total (pagination) เกินจริง. crawlId scope มากับ subquery.
    const latestSnapIds = this.db
      .select({ id: sql<number>`max(${pageSnapshots.id})` })
      .from(pageSnapshots)
      .where(eq(pageSnapshots.crawlId, cid))
      .groupBy(pageSnapshots.pageId);

    const conds = [
      inArray(pageSnapshots.id, latestSnapIds),
      eq(pages.projectId, projectId),
    ];
    if (opts.search) {
      const s = `%${opts.search}%`;
      conds.push(or(like(pages.url, s), like(pageSnapshots.title, s))!);
    }
    const where = and(...conds);

    const items = await this.db
      .select({
        pageId: pages.id,
        url: pages.url,
        httpStatus: pageSnapshots.httpStatus,
        title: pageSnapshots.title,
        wordCount: pageSnapshots.wordCount,
        internalLinks: pageSnapshots.internalLinks,
        externalLinks: pageSnapshots.externalLinks,
        imagesMissingAlt: pageSnapshots.imagesMissingAlt,
        healthScore: seoScores.healthScore,
        keywordCoverage: seoScores.keywordCoverage,
        lastCrawledAt: pageSnapshots.createdAt,
      })
      .from(pageSnapshots)
      .innerJoin(pages, eq(pages.id, pageSnapshots.pageId))
      .leftJoin(seoScores, eq(seoScores.snapshotId, pageSnapshots.id))
      .where(where)
      .orderBy(asc(pages.url))
      .limit(opts.limit)
      .offset(opts.offset);

    const [{ value }] = await this.db
      .select({ value: count() })
      .from(pageSnapshots)
      .innerJoin(pages, eq(pages.id, pageSnapshots.pageId))
      .where(where);

    return {
      items,
      total: value,
      limit: opts.limit,
      offset: opts.offset,
      crawlId: cid,
    };
  }

  /** รายละเอียดหน้าเดียว — null ถ้าไม่ใช่เจ้าของ/ไม่พบ (service เป็นคน 404). */
  async getDetail(projectId: number, pageId: number) {
    const pageRows = await this.db
      .select({
        id: pages.id,
        url: pages.url,
        isIndexable: pages.isIndexable,
        firstSeenAt: pages.firstSeenAt,
        lastSeenAt: pages.lastSeenAt,
      })
      .from(pages)
      .where(and(eq(pages.id, pageId), eq(pages.projectId, projectId)))
      .limit(1);
    const page = pageRows[0];
    if (!page) return null;

    const snapRows = await this.db
      .select({
        id: pageSnapshots.id,
        crawlId: pageSnapshots.crawlId,
        httpStatus: pageSnapshots.httpStatus,
        title: pageSnapshots.title,
        metaDescription: pageSnapshots.metaDescription,
        h1: pageSnapshots.h1,
        headings: pageSnapshots.headings,
        wordCount: pageSnapshots.wordCount,
        canonical: pageSnapshots.canonical,
        robotsMeta: pageSnapshots.robotsMeta,
        schemaTypes: pageSnapshots.schemaTypes,
        internalLinks: pageSnapshots.internalLinks,
        externalLinks: pageSnapshots.externalLinks,
        imagesTotal: pageSnapshots.imagesTotal,
        imagesMissingAlt: pageSnapshots.imagesMissingAlt,
        lcpMs: pageSnapshots.lcpMs,
        clsX1000: pageSnapshots.clsX1000,
        inpMs: pageSnapshots.inpMs,
        createdAt: pageSnapshots.createdAt,
      })
      .from(pageSnapshots)
      .where(eq(pageSnapshots.pageId, pageId))
      .orderBy(desc(pageSnapshots.createdAt))
      .limit(1);
    const snap = snapRows[0] ?? null;

    const snapshot = snap
      ? {
          snapshotId: snap.id,
          crawlId: snap.crawlId,
          httpStatus: snap.httpStatus,
          title: snap.title,
          metaDescription: snap.metaDescription,
          h1: snap.h1,
          headings: snap.headings,
          wordCount: snap.wordCount,
          canonical: snap.canonical,
          robotsMeta: snap.robotsMeta,
          schemaTypes: snap.schemaTypes,
          internalLinks: snap.internalLinks,
          externalLinks: snap.externalLinks,
          imagesTotal: snap.imagesTotal,
          imagesMissingAlt: snap.imagesMissingAlt,
          lcpMs: snap.lcpMs,
          clsX1000: snap.clsX1000,
          inpMs: snap.inpMs,
          createdAt: snap.createdAt,
        }
      : null;

    let score: {
      keywordCoverage: number | null;
      healthScore: number | null;
      breakdown: unknown;
    } | null = null;
    if (snap) {
      const sc = await this.db
        .select({
          keywordCoverage: seoScores.keywordCoverage,
          healthScore: seoScores.healthScore,
          breakdown: seoScores.breakdown,
        })
        .from(seoScores)
        .where(eq(seoScores.snapshotId, snap.id))
        .limit(1);
      score = sc[0] ?? null;
    }

    const rankingRows = await this.db
      .select({
        keyword: keywords.keyword,
        position: pageKeywords.position,
        traffic: pageKeywords.traffic,
        trafficValue: pageKeywords.trafficValue,
        // metric ของ keyword (join keywords) — KD/volume/cpc/intent (เติมจาก Ahrefs enrich)
        difficulty: keywords.difficulty,
        searchVolume: keywords.searchVolume,
        cpc: keywords.cpc,
        intent: keywords.intent,
      })
      .from(pageKeywords)
      .innerJoin(keywords, eq(keywords.id, pageKeywords.keywordId))
      .where(eq(pageKeywords.pageId, pageId))
      .orderBy(desc(pageKeywords.traffic))
      .limit(20);
    const ranking = rankingRows.map((r) => ({
      keyword: r.keyword,
      position: r.position,
      traffic: r.traffic,
      // trafficValue/cpc เป็น DECIMAL → mysql2 คืน string → coerce เป็น number (DTO เป็น number)
      trafficValue: r.trafficValue != null ? Number(r.trafficValue) : null,
      difficulty: r.difficulty,
      searchVolume: r.searchVolume,
      cpc: r.cpc != null ? Number(r.cpc) : null,
      intent: r.intent,
    }));

    const links = snap
      ? await this.db
          .select({
            toUrl: pageLinks.toUrl,
            anchorText: pageLinks.anchorText,
            rel: pageLinks.rel,
            isInternal: pageLinks.isInternal,
          })
          .from(pageLinks)
          .where(
            and(
              eq(pageLinks.fromPageId, pageId),
              eq(pageLinks.crawlId, snap.crawlId),
            ),
          )
          .limit(100)
      : [];

    const images = snap
      ? await this.db
          .select({
            src: pageImages.src,
            alt: pageImages.alt,
            hasAlt: pageImages.hasAlt,
          })
          .from(pageImages)
          .where(eq(pageImages.snapshotId, snap.id))
          .limit(100)
      : [];

    const findings = await this.db
      .select({
        id: auditFindings.id,
        type: auditFindings.type,
        severity: auditFindings.severity,
        impactScore: auditFindings.impactScore,
        status: auditFindings.status,
        details: auditFindings.details,
        detectedAt: auditFindings.detectedAt,
      })
      .from(auditFindings)
      .where(eq(auditFindings.pageId, pageId))
      .orderBy(desc(auditFindings.impactScore))
      .limit(100);

    const backlinks = await this.pageBacklinks(projectId, pageId);
    const projDomain = await this.projectDomain(projectId);
    const serp = await this.primaryKeywordSerp(pageId, projDomain);
    const contentGapsOut = await this.pageContentGaps(projectId, pageId);

    return {
      page,
      snapshot,
      score,
      ranking,
      backlinks,
      serp,
      links,
      images,
      findings,
      contentGaps: contentGapsOut,
    };
  }

  /** domain เป้าของ project (ใช้ตัดสิน isOwn ใน SERP) — null ถ้าไม่พบ. */
  private async projectDomain(projectId: number): Promise<string | null> {
    const rows = await this.db
      .select({ domain: projects.domain })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return rows[0]?.domain ?? null;
  }

  /**
   * Page Authority/Backlinks: snapshot DR/UR/refdomains ล่าสุด (page-level ก่อน, fallback
   * domain-level pageId IS NULL) + organic traffic/value/จำนวน keyword ของหน้านี้ (รวมจาก
   * "row ล่าสุดต่อ keyword" ของ page_keywords กันนับซ้ำข้าม capture). null ถ้าไม่มีข้อมูลเลย.
   */
  private async pageBacklinks(projectId: number, pageId: number) {
    const cols = {
      domainRating: backlinkSnapshots.domainRating,
      urlRating: backlinkSnapshots.urlRating,
      referringDomains: backlinkSnapshots.referringDomains,
      capturedAt: backlinkSnapshots.capturedAt,
    };
    const pageRows = await this.db
      .select(cols)
      .from(backlinkSnapshots)
      .where(eq(backlinkSnapshots.pageId, pageId))
      .orderBy(desc(backlinkSnapshots.capturedAt))
      .limit(1);
    let scope: 'page' | 'domain' | null = pageRows[0] ? 'page' : null;
    let row = pageRows[0] ?? null;
    if (!row) {
      const domainRows = await this.db
        .select(cols)
        .from(backlinkSnapshots)
        .where(
          and(
            eq(backlinkSnapshots.projectId, projectId),
            isNull(backlinkSnapshots.pageId),
          ),
        )
        .orderBy(desc(backlinkSnapshots.capturedAt))
        .limit(1);
      row = domainRows[0] ?? null;
      scope = row ? 'domain' : null;
    }

    // organic summary: รวมจาก row ล่าสุดต่อ keyword (MAX(id) GROUP BY keyword_id)
    const latestPk = this.db
      .select({ id: sql<number>`max(${pageKeywords.id})` })
      .from(pageKeywords)
      .where(eq(pageKeywords.pageId, pageId))
      .groupBy(pageKeywords.keywordId);
    const agg = await this.db
      .select({
        orgTraffic: sql<string>`coalesce(sum(${pageKeywords.traffic}), 0)`,
        orgValue: sql<string>`coalesce(sum(${pageKeywords.trafficValue}), 0)`,
        orgKeywords: count(),
      })
      .from(pageKeywords)
      .where(inArray(pageKeywords.id, latestPk));
    const orgKeywords = Number(agg[0]?.orgKeywords ?? 0);
    const hasOrg = orgKeywords > 0;

    if (!row && !hasOrg) return null;
    return {
      scope,
      domainRating: row?.domainRating ?? null,
      urlRating: row?.urlRating ?? null,
      referringDomains: row?.referringDomains ?? null,
      orgTraffic: hasOrg ? Number(agg[0].orgTraffic) : null,
      orgValue: hasOrg ? Number(agg[0].orgValue) : null,
      orgKeywords: hasOrg ? orgKeywords : null,
      capturedAt: row?.capturedAt ?? null,
    };
  }

  /**
   * SERP คู่แข่งของ primary keyword (top by traffic ของหน้านี้) — เอา capture ล่าสุด (≤10 row)
   * แล้วเรียงตามอันดับ. isOwn = domain ตรงกับ domain ของ project (own page บน SERP).
   */
  private async primaryKeywordSerp(pageId: number, projDomain: string | null) {
    const primary = await this.db
      .select({ keywordId: pageKeywords.keywordId })
      .from(pageKeywords)
      .where(eq(pageKeywords.pageId, pageId))
      .orderBy(desc(pageKeywords.traffic))
      .limit(1);
    const keywordId = primary[0]?.keywordId ?? null;
    if (keywordId == null) return [];

    // serp_results เป็น time-series → เอา row ใหม่สุดก่อน (capture ล่าสุด ~10 row) แล้ว sort อันดับ
    const rows = await this.db
      .select({
        position: serpResults.position,
        url: serpResults.url,
        domain: serpResults.domain,
      })
      .from(serpResults)
      .where(eq(serpResults.keywordId, keywordId))
      .orderBy(desc(serpResults.capturedAt), asc(serpResults.position))
      .limit(10);
    const own = projDomain ? this.normDomain(projDomain) : null;
    return rows
      .map((r) => ({
        position: r.position,
        url: r.url,
        domain: r.domain,
        isOwn: own != null && this.domainMatches(r.domain, own),
      }))
      .sort((a, b) => a.position - b.position);
  }

  /** content gaps ที่ผูกกับหน้านี้ (pageId) หรือ keyword ของหน้า — ≤20 รายการ. */
  private async pageContentGaps(projectId: number, pageId: number) {
    const pkRows = await this.db
      .select({ keywordId: pageKeywords.keywordId })
      .from(pageKeywords)
      .where(eq(pageKeywords.pageId, pageId));
    const keywordIds = [...new Set(pkRows.map((r) => r.keywordId))];
    const match = keywordIds.length
      ? or(
          eq(contentGaps.pageId, pageId),
          inArray(contentGaps.keywordId, keywordIds),
        )
      : eq(contentGaps.pageId, pageId);
    const rows = await this.db
      .select({
        missingSubtopic: contentGaps.missingSubtopic,
        competitorDomains: contentGaps.competitorDomains,
      })
      .from(contentGaps)
      .where(and(eq(contentGaps.projectId, projectId), match))
      .orderBy(desc(contentGaps.createdAt))
      .limit(20);
    return rows.map((r) => ({
      missingSubtopic: r.missingSubtopic,
      competitorDomains: r.competitorDomains,
    }));
  }

  /** ตัด protocol/www/trailing slash ออก → เทียบ domain แบบหลวม. */
  private normDomain(d: string): string {
    return d
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
  }

  /** serp domain ตรงกับ own ไหม (equal หรือ subdomain ของ own). */
  private domainMatches(serpDomain: string, own: string): boolean {
    const d = this.normDomain(serpDomain);
    return d === own || d.endsWith(`.${own}`);
  }
}
