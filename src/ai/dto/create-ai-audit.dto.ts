import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Input ของ stage [4] AI Advisor — Zod เป็น validation layer เดียว (เอกสาร 00 §1).
 * reuse schema ได้ทั้ง DTO (api) และ payload ของ job (worker).
 */

/** POST audit — เลือก crawl/page (ไม่ระบุ crawlId = crawl ล่าสุด; ไม่ระบุ pageId = ทุกเพจ). */
export const createAiAuditSchema = z.object({
  crawlId: z.coerce.number().int().positive().optional(),
  pageId: z.coerce.number().int().positive().optional(),
});
export class CreateAiAuditDto extends createZodDto(createAiAuditSchema) {}

/** ชนิด recommendation (ตรงกับ enum ai_recommendations.type ใน schema). */
export const recommendationTypeEnum = z.enum([
  'diagnosis',
  'title_draft',
  'meta_draft',
  'intent',
  'content_gap',
  'query_fanout',
  'priority',
]);
export const recommendationStatusEnum = z.enum([
  'suggested',
  'applied',
  'rejected',
]);

/** GET recommendations — filter + pagination. */
export const listRecommendationsQuerySchema = z.object({
  pageId: z.coerce.number().int().positive().optional(),
  type: recommendationTypeEnum.optional(),
  status: recommendationStatusEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export class ListRecommendationsQueryDto extends createZodDto(
  listRecommendationsQuerySchema,
) {}
