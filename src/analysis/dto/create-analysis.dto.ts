import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Input ของ stage [3] Analysis — Zod เป็น validation layer เดียว (เอกสาร 04 §6).
 * reuse schema ได้ทั้ง DTO (api) และ payload ของ job (worker).
 */

/** POST analysis — เลือก crawl ที่จะวิเคราะห์ (ไม่ระบุ = crawl ล่าสุด). */
export const createAnalysisSchema = z.object({
  crawlId: z.coerce.number().int().positive().optional(),
});
export class CreateAnalysisDto extends createZodDto(createAnalysisSchema) {}

/** GET findings — filter + pagination (เรียงตาม impactScore ในชั้น repo). */
export const listFindingsQuerySchema = z.object({
  status: z.enum(['open', 'in_progress', 'fixed', 'ignored']).optional(),
  type: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export class ListFindingsQueryDto extends createZodDto(
  listFindingsQuerySchema,
) {}

/** GET scores — เลือก crawl (ไม่ระบุ = crawl ล่าสุด). */
export const listScoresQuerySchema = z.object({
  crawlId: z.coerce.number().int().positive().optional(),
});
export class ListScoresQueryDto extends createZodDto(listScoresQuerySchema) {}
