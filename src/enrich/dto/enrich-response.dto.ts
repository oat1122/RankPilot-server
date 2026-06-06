import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response shapes ของ /projects/:projectId/ahrefs/* — Zod ตัวเดียว (เอกสาร 04 §6)
 * document `data` ใน envelope ให้ TS client ฝั่ง web เห็น type จริง.
 */

/** POST enrich — api แค่ enqueue แล้วคืน jobId (เอกสาร 00 §4). */
export const enrichEnqueuedSchema = z.object({
  jobId: z.string(),
  projectId: z.number(),
  status: z.literal('queued'),
});
export class EnrichEnqueuedDto extends createZodDto(enrichEnqueuedSchema) {}

/** สรุปผล enrich (= job.returnvalue เมื่อ completed). */
export const enrichSummarySchema = z.object({
  projectId: z.number(),
  domain: z.string(),
  fetched: z.number(),
  keywordsUpserted: z.number(),
  pageKeywordsInserted: z.number(),
  unitsSpent: z.number(),
  cached: z.boolean(),
});

/** GET enrich/:jobId — สถานะ job + สรุปผลเมื่อ state=completed. */
export const enrichStatusSchema = z.object({
  jobId: z.string(),
  // BullMQ JobState: waiting | active | completed | failed | delayed | ...
  state: z.string(),
  result: enrichSummarySchema.nullable(),
  failedReason: z.string().nullable(),
});
export class EnrichStatusDto extends createZodDto(enrichStatusSchema) {}

/** GET budget — งบ units เดือนปัจจุบัน (Redis counter + เพดานโปรเจค). */
export const ahrefsBudgetSchema = z.object({
  projectId: z.number(),
  period: z.string(), // 'YYYY-MM'
  unitsSpent: z.number(),
  cap: z.number(),
  remaining: z.number(),
});
export class AhrefsBudgetDto extends createZodDto(ahrefsBudgetSchema) {}
