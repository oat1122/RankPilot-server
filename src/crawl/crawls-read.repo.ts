import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import { crawls } from '../db/schema';

/** สถานะ crawl (ตรงกับ enum crawls.status, เอกสาร 01 §2). */
export type CrawlStatus = 'queued' | 'running' | 'done' | 'failed' | 'partial';

/** ตัวเลือก list crawls — paging + filter status. */
export interface ListCrawlsOptions {
  limit: number;
  offset: number;
  status?: CrawlStatus;
}

/** projection ที่ส่งออก API (ตรงกับ crawlListItemSchema). */
const crawlCols = {
  id: crawls.id,
  status: crawls.status,
  trigger: crawls.trigger,
  pagesDiscovered: crawls.pagesDiscovered,
  pagesCrawled: crawls.pagesCrawled,
  startedAt: crawls.startedAt,
  finishedAt: crawls.finishedAt,
  createdAt: crawls.createdAt,
};

/**
 * CrawlsReadRepo — read-only list crawls ของ project (เอกสาร 01 §2). write path (createCrawl/
 * persistPage) อยู่ที่ worker (CrawlerRepo) — repo นี้แค่อ่านให้ dashboard: KPI "จำนวน Crawl"
 * = total + ประวัติ crawl. inject DB token (@Global) เหมือน repo อื่น ๆ. ใช้ ix_crawls_project.
 */
@Injectable()
export class CrawlsReadRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  async listByProject(projectId: number, opts: ListCrawlsOptions) {
    const where = opts.status
      ? and(eq(crawls.projectId, projectId), eq(crawls.status, opts.status))
      : eq(crawls.projectId, projectId);

    const items = await this.db
      .select(crawlCols)
      .from(crawls)
      .where(where)
      .orderBy(desc(crawls.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);

    const [{ value }] = await this.db
      .select({ value: count() })
      .from(crawls)
      .where(where);

    return { items, total: value, limit: opts.limit, offset: opts.offset };
  }
}
