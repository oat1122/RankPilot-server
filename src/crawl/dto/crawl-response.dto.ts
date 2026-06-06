import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { crawlResultSchema } from '../../crawler/crawler.schema';

/**
 * Response shapes ของ /crawls — เป็น Zod ตัวเดียว (เอกสาร 04 §6) ใช้ document `data`
 * ใน envelope ให้ TS client ฝั่ง web เห็น type จริง ไม่ใช่ object เปล่า.
 */

/** POST /crawls — api แค่ enqueue แล้วคืน jobId (เอกสาร 00 §4). */
export const crawlEnqueuedSchema = z.object({
  jobId: z.string(),
  status: z.literal('queued'),
});
export class CrawlEnqueuedDto extends createZodDto(crawlEnqueuedSchema) {}

/** GET /crawls/:id — สถานะ job + ผล on-page เมื่อ state=completed. */
export const crawlStatusSchema = z.object({
  jobId: z.string(),
  url: z.string().nullable(),
  // BullMQ JobState: waiting | active | completed | failed | delayed | prioritized | paused | unknown
  state: z.string(),
  result: crawlResultSchema.nullable(),
  failedReason: z.string().nullable(),
});
export class CrawlStatusDto extends createZodDto(crawlStatusSchema) {}
