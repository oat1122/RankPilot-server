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

/** สรุปผล audit-page/resume-review (= job.returnvalue เมื่อ completed). */
export const pageAuditSummarySchema = z.object({
  projectId: z.number(),
  pageId: z.number(),
  runId: z.number(),
  recommendationsCreated: z.number(),
  draftAttempts: z.number(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  // Phase 4: 'awaiting_review' = ค้างรอ user อนุมัติ (HITL); 'done' = persist แล้ว
  status: z.enum(['done', 'awaiting_review']),
});

/** GET jobs/:jobId — สถานะ job + สรุปเมื่อ state=completed. */
export const aiStatusSchema = z.object({
  jobId: z.string(),
  name: z.string(), // 'audit-page' | 'resume-review'
  state: z.string(), // waiting | active | completed | failed | delayed
  result: pageAuditSummarySchema.nullable(),
  failedReason: z.string().nullable(),
});
export class AiStatusDto extends createZodDto(aiStatusSchema) {}

/** 1 ai_run (Phase 4 — dashboard list รอรีวิว + proposal ที่ค้าง). */
export const aiRunSchema = z.object({
  id: z.number(),
  pageId: z.number().nullable(),
  graph: z.string(),
  status: z.string(), // running | done | failed | awaiting_review
  reviewPayload: z.unknown(), // proposal ที่รอ approve/reject (null เมื่อไม่ค้าง)
  startedAt: z.coerce.string(),
  finishedAt: z.coerce.string().nullable(),
});

/** GET runs — list + total สำหรับ pagination. */
export const aiRunsSchema = z.object({
  items: z.array(aiRunSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export class AiRunsDto extends createZodDto(aiRunsSchema) {}

/** POST runs/:runId/review — enqueue resume job (Phase 4 HITL). */
export const aiReviewQueuedSchema = z.object({
  runId: z.number(),
  decision: z.enum(['approve', 'reject']),
  jobId: z.string().nullable(),
  status: z.literal('queued'),
});
export class AiReviewQueuedDto extends createZodDto(aiReviewQueuedSchema) {}

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
