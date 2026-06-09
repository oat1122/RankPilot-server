import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * query ของ GET /projects/:projectId/pages — list หน้าจาก crawl ที่เลือก/ล่าสุด.
 * coerce จาก string (query string เป็น string เสมอ). search = LIKE บน url/title.
 */
export const listPagesQuerySchema = z.object({
  crawlId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  search: z.string().trim().max(255).optional(),
});
export class ListPagesQueryDto extends createZodDto(listPagesQuerySchema) {}

/** 1 หน้าใน list = snapshot ล่าสุดของ crawl ที่เลือก join page url + seo_scores (left). */
export const pageListItemSchema = z.object({
  pageId: z.number(),
  url: z.string(),
  httpStatus: z.number().nullable(),
  title: z.string().nullable(),
  wordCount: z.number().nullable(),
  internalLinks: z.number().nullable(),
  externalLinks: z.number().nullable(),
  imagesMissingAlt: z.number().nullable(),
  healthScore: z.number().nullable(),
  keywordCoverage: z.number().nullable(),
  lastCrawledAt: z.coerce.string().nullable(),
});

/** GET pages — list + total (pagination) + crawlId ที่ resolve จริง (ล่าสุดถ้าไม่ส่ง). */
export const pageListSchema = z.object({
  items: z.array(pageListItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  crawlId: z.number().nullable(),
});
export class PageListDto extends createZodDto(pageListSchema) {}
