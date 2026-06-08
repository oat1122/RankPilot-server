import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response shapes ของ /trends/* — Zod เดียว (เอกสาร 04 §6) document `data` ใน envelope ให้
 * TS client. avg เป็น null ได้ ถ้า crawl นั้นยังไม่มี seo_scores (analysis ยังไม่รัน).
 */
export const scoreTrendPointSchema = z.object({
  crawlId: z.number(),
  createdAt: z.coerce.string(),
  pagesCrawled: z.number(),
  avgHealthScore: z.number().nullable(),
  avgKeywordCoverage: z.number().nullable(),
});
export const scoreTrendSchema = z.object({
  points: z.array(scoreTrendPointSchema),
});
export class ScoreTrendDto extends createZodDto(scoreTrendSchema) {}

/** 1 จุดของ crawl activity (ต่อวัน). */
export const crawlActivityPointSchema = z.object({
  day: z.string(), // YYYY-MM-DD
  crawls: z.number(),
  pagesCrawled: z.number(),
});
export const crawlActivitySchema = z.object({
  points: z.array(crawlActivityPointSchema),
});
export class CrawlActivityDto extends createZodDto(crawlActivitySchema) {}
