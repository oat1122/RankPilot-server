import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import {
  crawls,
  pageImages,
  pageLinks,
  pageSnapshots,
  pages,
} from '../db/schema';
import { normalizeUrl, urlHash, urlHashOrNull } from '../common/url';
import type { CrawlImage, CrawlResult } from './crawler.schema';
import type { CrawlCwv } from '../psi/psi.service';

/** executor ใน transaction — มี query builder เดียวกับ Db (insert/select/update/$returningId). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** input ของ persistPage — รวม storage key + CWV ที่ดึงมาแล้วนอก tx (best-effort, อาจ null). */
export interface PersistPageInput {
  crawlId: number;
  projectId: number;
  result: CrawlResult;
  htmlStorageKey: string | null; // HTML snapshot key (disk path, null = ไม่ได้เก็บ)
  cwv: CrawlCwv; // lcp/cls/inp จาก PSI (null ต่อ metric ถ้าไม่มี)
}

/**
 * CrawlerRepo — persist ผล crawl ลง DB (เอกสาร 04 §7 step 2: crawl → pages + page_snapshots
 * + page_links + page_images). flow [1] เดิมแค่คืน job.returnvalue; repo นี้ทำให้ stage [3]
 * Analysis มี input จริง. inject DB (token @Global) แบบเดียวกับ AhrefsRepo. รันใน worker เท่านั้น.
 */
@Injectable()
export class CrawlerRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * เปิด crawl รอบใหม่ (status=running) — คืน crawlId. อยู่ "นอก" transaction ∵ ต้องได้ id
   * ไปประกอบ storage key ก่อนเขียนไฟล์ HTML (ดู CrawlProcessor.persist).
   */
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

  /**
   * persist 1 หน้าแบบ atomic ใน transaction: upsert page → snapshot(+storage key +CWV) → images
   * → links → ปิด crawl (done/partial). ครอบ tx → พังกลางทาง rollback ทั้งชุด กัน partial write
   * ตอน BullMQ retry (attempts:2). คืน {pageId, snapshotId}.
   */
  async persistPage(
    input: PersistPageInput,
  ): Promise<{ pageId: number; snapshotId: number }> {
    return this.db.transaction(async (tx) => {
      const pageId = await this.upsertPageTx(
        tx,
        input.projectId,
        // key หน้าด้วย finalUrl (หลัง follow redirect) ไม่ใช่ url ที่ขอ — flow [2] Ahrefs join
        // ranking ด้วย best_position_url (= canonical/URL หลัง redirect ที่ Google index) ผ่าน
        // url_hash เดียวกัน. ถ้า key ด้วย url เดิม (ก่อน redirect) hash สองฝั่งไม่ตรง →
        // page_keywords ไม่ผูกเข้าหน้า → stage [3] Analysis ไม่มี ranking signal (keywordCoverage
        // เป็น null + impact ไม่ถ่วง traffic ทุกหน้า). เอกสาร 03 §6 / common/url.ts header.
        input.result.finalUrl,
      );
      const snapshotId = await this.insertSnapshotTx(tx, {
        crawlId: input.crawlId,
        pageId,
        result: input.result,
        htmlStorageKey: input.htmlStorageKey,
        cwv: input.cwv,
      });
      await this.insertImagesTx(tx, snapshotId, input.result.imageRows);
      await this.insertLinksTx(
        tx,
        input.crawlId,
        input.projectId,
        pageId,
        input.result.links,
      );
      await tx
        .update(crawls)
        .set({
          status: input.result.httpStatus >= 400 ? 'partial' : 'done',
          pagesDiscovered: 1,
          pagesCrawled: 1,
          finishedAt: new Date(),
        })
        .where(eq(crawls.id, input.crawlId));
      return { pageId, snapshotId };
    });
  }

  /** mark crawl ล้ม (นอก tx — เรียกใน catch ของ processor, best-effort ไม่กลืน error เดิม). */
  async markFailed(crawlId: number): Promise<void> {
    await this.db
      .update(crawls)
      .set({
        status: 'failed',
        pagesDiscovered: 1,
        pagesCrawled: 0,
        finishedAt: new Date(),
      })
      .where(eq(crawls.id, crawlId));
  }

  /* ---------- transactional writes (private — รับ executor ของ tx) ---------- */

  /**
   * upsert page (uq project+url_hash) คืน pageId — url_hash คิดแบบเดียวกับ enrichment join
   * (sha1 ของ normalizeUrl). caller ส่ง result.finalUrl (หลัง redirect) เพื่อให้ hash ตรงกับ
   * best_position_url ที่ Ahrefs คืน; normalizeUrl idempotent → normalize ซ้ำตรงนี้ปลอดภัย.
   */
  private async upsertPageTx(
    tx: Tx,
    projectId: number,
    rawUrl: string,
  ): Promise<number> {
    const url = normalizeUrl(rawUrl);
    const hash = urlHash(url);
    await tx
      .insert(pages)
      .values({ projectId, url, urlHash: hash, lastSeenAt: new Date() })
      .onDuplicateKeyUpdate({ set: { lastSeenAt: new Date() } });

    const rows = await tx
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.projectId, projectId), eq(pages.urlHash, hash)))
      .limit(1);
    return rows[0].id;
  }

  /** insert page_snapshot จาก CrawlResult (+storage key +CWV) — map ตรง field เอกสาร 01 §2. */
  private async insertSnapshotTx(
    tx: Tx,
    input: {
      crawlId: number;
      pageId: number;
      result: CrawlResult;
      htmlStorageKey: string | null;
      cwv: CrawlCwv;
    },
  ): Promise<number> {
    const r = input.result;
    const [{ id }] = await tx
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
        lcpMs: input.cwv.lcpMs, // CWV จาก PSI (null ถ้าไม่มี/ปิด)
        clsX1000: input.cwv.clsX1000,
        inpMs: input.cwv.inpMs,
        contentHash: r.contentHash,
        htmlStorageKey: input.htmlStorageKey, // HTML snapshot key (disk, null ถ้าไม่ได้เก็บ)
        bodyText: r.bodyText,
      })
      .$returningId();
    return id;
  }

  /** bulk insert page_images (เอกสาร 01 §2) — bytes ปล่อย null (เก็บภายหลัง). */
  private async insertImagesTx(
    tx: Tx,
    snapshotId: number,
    images: CrawlImage[],
  ): Promise<void> {
    if (images.length === 0) return;
    await tx.insert(pageImages).values(
      images.map((img) => ({
        snapshotId,
        src: img.src,
        alt: img.alt,
        hasAlt: img.hasAlt,
      })),
    );
  }

  /**
   * bulk insert page_links — resolve toPageId ของลิงก์ภายในแบบ batch (1 query) ผ่าน url_hash;
   * ปลายทางที่ยัง crawl ไม่ถึง = toPageId null (best-effort, เอกสาร 01). single-page รอบนี้
   * ส่วนใหญ่จึง null = ปกติ (จะเต็มเมื่อทำ multi-page).
   */
  private async insertLinksTx(
    tx: Tx,
    crawlId: number,
    projectId: number,
    fromPageId: number,
    links: CrawlResult['links'],
  ): Promise<void> {
    if (links.length === 0) return;

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
      const rows = await tx
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

    await tx.insert(pageLinks).values(
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
}
