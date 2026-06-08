import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import { crawls, pageSnapshots, seoScores } from '../db/schema';

/** ช่วงเวลา (Date) ที่ service คำนวณจาก query (default 30 วันล่าสุด). */
export interface TrendWindow {
  from: Date;
  to: Date;
}

/** crawl ที่ "วิเคราะห์ได้" เท่านั้นที่มี seo_scores (running/failed ไม่มี snapshot สมบูรณ์). */
const ANALYZABLE: ('done' | 'partial')[] = ['done', 'partial'];

/**
 * TrendsRepo — time-series read จากข้อมูลที่มีจริง (เอกสาร 06 P3): crawls + seo_scores (ผ่าน
 * page_snapshots). inject DB token (@Global). AVG/SUM คืนเป็น DECIMAL string (mysql2) → service
 * coerce เป็น number. ranking/backlink history รอ Ahrefs live ค่อยเพิ่ม endpoint.
 */
@Injectable()
export class TrendsRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * avg health/keyword score ต่อ crawl (done/partial) ในช่วง — join crawls→page_snapshots→
   * seo_scores. group ต่อ crawl + order ตามเวลา (ให้ FE plot + before/after = จุดแรก/สุดท้าย).
   * left join → crawl ที่ยังไม่มี score คืน avg=null (ไม่หาย).
   */
  scoreTrend(projectId: number, w: TrendWindow) {
    return this.db
      .select({
        crawlId: crawls.id,
        createdAt: crawls.createdAt,
        pagesCrawled: crawls.pagesCrawled,
        avgHealthScore: sql<string | null>`AVG(${seoScores.healthScore})`,
        avgKeywordCoverage: sql<
          string | null
        >`AVG(${seoScores.keywordCoverage})`,
      })
      .from(crawls)
      .leftJoin(pageSnapshots, eq(pageSnapshots.crawlId, crawls.id))
      .leftJoin(seoScores, eq(seoScores.snapshotId, pageSnapshots.id))
      .where(
        and(
          eq(crawls.projectId, projectId),
          inArray(crawls.status, ANALYZABLE),
          gte(crawls.createdAt, w.from),
          lte(crawls.createdAt, w.to),
        ),
      )
      .groupBy(crawls.id, crawls.createdAt, crawls.pagesCrawled)
      .orderBy(asc(crawls.createdAt));
  }

  /**
   * crawl activity ต่อวัน — count crawl + sum pages (ทุก status = ความเคลื่อนไหวรวม). group ตาม
   * DATE(created_at) (รวมทั้งวันเป็น 1 จุด) เรียงตามวัน.
   */
  crawlActivity(projectId: number, w: TrendWindow) {
    const day = sql<string>`DATE(${crawls.createdAt})`;
    return this.db
      .select({
        day,
        crawls: count(),
        pagesCrawled: sql<string | null>`SUM(${crawls.pagesCrawled})`,
      })
      .from(crawls)
      .where(
        and(
          eq(crawls.projectId, projectId),
          gte(crawls.createdAt, w.from),
          lte(crawls.createdAt, w.to),
        ),
      )
      .groupBy(day)
      .orderBy(day);
  }
}
