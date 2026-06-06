import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Body ของ POST /projects/:projectId/ahrefs/enrich — ทั้งสอง field optional:
 * domain/budget มาจาก projects (โหลดใน service), เหลือ override country + จำนวนแถว.
 * limit เพดาน 100 แต่ Lite จริง ~10 rows/request (เอกสาร 03 §0) — default ตั้งใน service.
 */
export const createEnrichSchema = z.object({
  country: z.string().length(2).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export class CreateEnrichDto extends createZodDto(createEnrichSchema) {}

/**
 * Body ของ POST /ahrefs/keywords — batch enrich keyword ที่ "ยังไม่ติด" ผ่าน
 * Keywords Explorer overview (เอกสาร 03a §4.1). keywords required (>=1); worker dedup/sort ให้.
 * เพดาน 200 กัน payload บวม — ระวัง cost = base 50 + Σfield×rows (rows = จำนวน keyword).
 */
export const enrichKeywordsSchema = z.object({
  keywords: z.array(z.string().trim().min(1)).min(1).max(200),
  country: z.string().length(2).optional(),
});

export class EnrichKeywordsDto extends createZodDto(enrichKeywordsSchema) {}

/**
 * Body ของ POST /ahrefs/top-pages — คัด top 20% by traffic ของ domain ก่อน enrich ราย URL
 * (เอกสาร 03a §4.2). optional: domain มาจาก project, country/limit override ได้.
 * enrichSelected=true → worker fan-out organic-keywords (mode=exact) ต่อรายหน้าที่คัด (orchestration).
 */
export const topPagesSchema = z.object({
  country: z.string().length(2).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  enrichSelected: z.boolean().optional(),
});

export class TopPagesDto extends createZodDto(topPagesSchema) {}

/**
 * Body ของ POST /ahrefs/competitors — คู่แข่ง organic ของ domain (เอกสาร 03a §4.3 → competitors).
 */
export const competitorsSchema = z.object({
  country: z.string().length(2).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export class CompetitorsDto extends createZodDto(competitorsSchema) {}

/**
 * Body ของ POST /ahrefs/serp — SERP overview ของ 1 keyword (เอกสาร 03a §5 → serp_results).
 * แพงต่อ keyword (rows = SERP) → ใช้เฉพาะ keyword สำคัญ; limit เพดานจำนวน SERP rows.
 */
export const serpOverviewSchema = z.object({
  keyword: z.string().trim().min(1),
  country: z.string().length(2).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export class SerpOverviewDto extends createZodDto(serpOverviewSchema) {}

/**
 * Body ของ POST /ahrefs/keyword-ideas — matching/related-terms ของ seed (เอกสาร 03a §5 →
 * content_gaps). mode: matching = "มีคำนี้อยู่", related = "ใกล้เคียง" (query fan-out).
 */
export const keywordIdeasSchema = z.object({
  seed: z.string().trim().min(1),
  mode: z.enum(['matching', 'related']).optional(),
  country: z.string().length(2).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export class KeywordIdeasDto extends createZodDto(keywordIdeasSchema) {}

/**
 * Body ของ POST /ahrefs/backlinks — DR/UR/refdomains ระดับ domain (เอกสาร 03a §6 →
 * backlink_snapshots). domain มาจาก project; เหลือ override country.
 */
export const backlinksSchema = z.object({
  country: z.string().length(2).optional(),
});

export class BacklinksDto extends createZodDto(backlinksSchema) {}
