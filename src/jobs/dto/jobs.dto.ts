import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * /jobs — มุมมองรวมงานเบื้องหลัง (BullMQ) ของ user ปัจจุบัน ข้ามทุกโปรเจค (เอกสาร 00 §4).
 * แหล่งความจริง = สแกนคิวสด (active/queued + ประวัติ completed/failed ที่ removeOnComplete/Fail เก็บไว้)
 * ไม่ใช่ตาราง DB → FE ใช้ derive สถานะ in-progress ที่ "รอด refresh" + กระดิ่งแจ้งเตือน.
 */

/** ชื่อคิวทั้งหมดฝั่ง producer (ตรงกับ BullModule.registerQueue ของแต่ละ domain). */
export const JOB_QUEUES = ['crawl', 'ahrefs', 'analysis', 'ai'] as const;
export type JobQueueName = (typeof JOB_QUEUES)[number];

/** สถานะที่ normalize แล้ว — waiting|delayed (BullMQ) ยุบเป็น 'queued'. */
export const jobStateSchema = z.enum([
  'queued',
  'active',
  'completed',
  'failed',
]);

/** ประเภทงานที่ FE ใช้เลือก label/ไอคอน (1 ต่อ 1 กับ job.name ฝั่ง worker). */
export const jobTypeSchema = z.enum([
  'site_crawl',
  'page_crawl',
  'enrich',
  'analysis',
  'ai_audit',
]);

/** 1 BullMQ job (ยังไม่จัดกลุ่ม) — FE รวม ai_audit ตาม (projectId, crawlId) เองตอนแสดงผล. */
export const jobViewSchema = z.object({
  id: z.string(),
  queue: z.enum(JOB_QUEUES),
  type: jobTypeSchema,
  label: z.string(),
  projectId: z.number().nullable(),
  pageId: z.number().nullable(),
  crawlId: z.number().nullable(),
  state: jobStateSchema,
  enqueuedAt: z.number().nullable(), // job.timestamp (ms)
  startedAt: z.number().nullable(), // job.processedOn (ms)
  finishedAt: z.number().nullable(), // job.finishedOn (ms)
  failedReason: z.string().nullable(),
});
export type JobView = z.infer<typeof jobViewSchema>;

/** GET /jobs — list งานของ user ปัจจุบัน เรียง active → queued → ประวัติ (ใหม่ก่อน). */
export const jobsViewSchema = z.object({
  items: z.array(jobViewSchema),
});
export class JobsViewDto extends createZodDto(jobsViewSchema) {}

/** GET /jobs?projectId&pageId — filter (optional) ให้ dashboard/page-detail ดึงเฉพาะที่สนใจ. */
export const listJobsQuerySchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  pageId: z.coerce.number().int().positive().optional(),
});
export class ListJobsQueryDto extends createZodDto(listJobsQuerySchema) {}
