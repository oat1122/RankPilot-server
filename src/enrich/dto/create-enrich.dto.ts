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
 * (เอกสาร 03a §4.2). ทั้งคู่ optional: domain มาจาก project, country/limit override ได้.
 */
export const topPagesSchema = z.object({
  country: z.string().length(2).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export class TopPagesDto extends createZodDto(topPagesSchema) {}
