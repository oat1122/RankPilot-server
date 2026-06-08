import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response shapes ของ /projects/:projectId/ai/* — Zod ตัวเดียว (เอกสาร 04 §6)
 * document `data` ใน envelope ให้ TS client ฝั่ง web เห็น type จริง.
 */

/** POST audit — api แค่ enqueue (1 job/เพจ) แล้วคืน jobIds (เอกสาร 00 §4). */
export const aiEnqueuedSchema = z.object({
  projectId: z.number(),
  crawlId: z.number(),
  enqueued: z.number(),
  jobIds: z.array(z.string()),
  status: z.literal('queued'),
});
export class AiEnqueuedDto extends createZodDto(aiEnqueuedSchema) {}

/** สรุปผล audit-page (= job.returnvalue เมื่อ completed). */
export const pageAuditSummarySchema = z.object({
  projectId: z.number(),
  pageId: z.number(),
  runId: z.number(),
  recommendationsCreated: z.number(),
  draftAttempts: z.number(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  status: z.literal('done'),
});

/** GET jobs/:jobId — สถานะ job + สรุปเมื่อ state=completed. */
export const aiStatusSchema = z.object({
  jobId: z.string(),
  name: z.string(), // 'audit-page'
  state: z.string(), // waiting | active | completed | failed | delayed
  result: pageAuditSummarySchema.nullable(),
  failedReason: z.string().nullable(),
});
export class AiStatusDto extends createZodDto(aiStatusSchema) {}

/** 1 recommendation (ai_recommendations) join page url — สำหรับ Dashboard. */
export const aiRecommendationSchema = z.object({
  id: z.number(),
  runId: z.number(),
  pageId: z.number(),
  url: z.string().nullable(),
  type: z.string(),
  output: z.unknown(),
  status: z.string(),
  createdAt: z.coerce.string(),
});

/** GET recommendations — list + total สำหรับ pagination. */
export const aiRecommendationsSchema = z.object({
  items: z.array(aiRecommendationSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export class AiRecommendationsDto extends createZodDto(
  aiRecommendationsSchema,
) {}
