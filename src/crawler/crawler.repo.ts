import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import { crawls, pageLinks, pageSnapshots, pages } from '../db/schema';
import { normalizeUrl, urlHash, urlHashOrNull } from '../common/url';
import type { CrawlResult } from './crawler.schema';

/**
 * CrawlerRepo — persist ผล crawl ลง DB (เอกสาร 04 §7 step 2: crawl → pages + page_snapshots
 * + page_links). flow [1] เดิมแค่คืน job.returnvalue; repo นี้ทำให้ stage [3] Analysis มี input
 * จริง. inject DB (token @Global) แบบเดียวกับ AhrefsRepo. รันใน worker เท่านั้น (api ≠ worker).
 */
@Injectable()
export class CrawlerRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** เปิด crawl รอบใหม่ (status=running) — คืน crawlId. */
  async createCrawl(
    projectId: number,
    trigger: 'manual' | 'scheduled' | 'api' = 'api',
  ): Promise<number> {
    const [{ id }] = await this.db
      .insert(crawls)
      .values({ projectId, trigger, status: 'running', startedAt: new Date() })
      .$returningId();
    return id;
  }

  /** upsert page (uq project+url_hash) คืน pageId — url_hash คิดแบบเดียวกับ enrichment join. */
  async upsertPage(projectId: number, rawUrl: string): Promise<number> {
    const url = normalizeUrl(rawUrl);
    const hash = urlHash(url);
    await this.db
      .insert(pages)
      .values({ projectId, url, urlHash: hash, lastSeenAt: new Date() })
      .onDuplicateKeyUpdate({ set: { lastSeenAt: new Date() } });

    const rows = await this.db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.projectId, projectId), eq(pages.urlHash, hash)))
      .limit(1);
    return rows[0].id;
  }

  /** insert page_snapshot จาก CrawlResult (map ตรง field เอกสาร 01 §2) — คืน snapshotId. */
  async insertSnapshot(input: {
    crawlId: number;
    pageId: number;
    result: CrawlResult;
  }): Promise<number> {
    const r = input.result;
    const [{ id }] = await this.db
      .insert(pageSnapshots)
      .values({
        crawlId: input.crawlId,
        pageId: input.pageId,
        httpStatus: r.httpStatus,
        redirectTo: r.finalUrl !== r.url ? r.finalUrl : null,
        title: r.title,
        metaDescription: r.metaDescription,
        h1: r.h1,
        headings: r.headings,
        paragraphs: r.paragraphs,
        wordCount: r.wordCount,
        canonical: r.canonical,
        robotsMeta: r.robotsMeta,
        schemaTypes: r.schemaTypes,
        internalLinks: r.internalLinks,
        externalLinks: r.externalLinks,
        imagesTotal: r.images.total,
        imagesMissingAlt: r.images.missingAlt,
        // lcp/cls/inp (PSI) + htmlStorageKey (R2) ยังไม่ wired → null
        contentHash: r.contentHash,
        bodyText: r.bodyText,
      })
      .$returningId();
    return id;
  }

  /**
   * bulk insert page_links ของหน้า — resolve toPageId ของลิงก์ภายในแบบ batch (1 query)
   * ผ่าน url_hash → ลิงก์ที่ปลายทางยัง crawl ไม่ถึง = toPageId null (best-effort, เอกสาร 01).
   */
  async insertLinks(
    crawlId: number,
    projectId: number,
    fromPageId: number,
    links: CrawlResult['links'],
  ): Promise<void> {
    if (links.length === 0) return;

    // map url_hash → pageId ของลิงก์ภายในที่มีหน้าอยู่แล้ว (resolve ทีเดียว)
    const internalHashes = [
      ...new Set(
        links
          .filter((l) => l.isInternal)
          .map((l) => urlHashOrNull(l.url))
          .filter((h): h is string => h != null),
      ),
    ];
    const idByHash = new Map<string, number>();
    if (internalHashes.length > 0) {
      const rows = await this.db
        .select({ id: pages.id, urlHash: pages.urlHash })
        .from(pages)
        .where(
          and(
            eq(pages.projectId, projectId),
            inArray(pages.urlHash, internalHashes),
          ),
        );
      for (const row of rows) idByHash.set(row.urlHash, row.id);
    }

    await this.db.insert(pageLinks).values(
      links.map((l) => {
        const hash = l.isInternal ? urlHashOrNull(l.url) : null;
        return {
          crawlId,
          fromPageId,
          toPageId: hash ? (idByHash.get(hash) ?? null) : null,
          toUrl: l.url,
          anchorText: l.anchorText,
          rel: l.rel,
          isInternal: l.isInternal,
        };
      }),
    );
  }

  /** ปิด crawl (status + finishedAt + counts). */
  async finishCrawl(
    crawlId: number,
    input: {
      status: 'done' | 'failed' | 'partial';
      pagesDiscovered: number;
      pagesCrawled: number;
    },
  ): Promise<void> {
    await this.db
      .update(crawls)
      .set({
        status: input.status,
        pagesDiscovered: input.pagesDiscovered,
        pagesCrawled: input.pagesCrawled,
        finishedAt: new Date(),
      })
      .where(eq(crawls.id, crawlId));
  }
}
