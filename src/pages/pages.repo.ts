import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, like, or } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import {
  auditFindings,
  crawls,
  keywords,
  pageImages,
  pageKeywords,
  pageLinks,
  pageSnapshots,
  pages,
  seoScores,
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

    const conds = [
      eq(pageSnapshots.crawlId, cid),
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
      // trafficValue เป็น DECIMAL → mysql2 คืน string → coerce เป็น number (DTO เป็น number)
      trafficValue: r.trafficValue != null ? Number(r.trafficValue) : null,
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

    return { page, snapshot, score, ranking, links, images, findings };
  }
}
