import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * 1 crawl row (เอกสาร 01 §2 crawls) — document `data` ใน envelope ให้ TS client.
 * dates coerce เป็น string (DB คืน Date; started/finished เป็น null ได้ก่อน crawl จบ).
 */
export const crawlListItemSchema = z.object({
  id: z.number(),
  status: z.enum(['queued', 'running', 'done', 'failed', 'partial']),
  trigger: z.enum(['manual', 'scheduled', 'api']),
  pagesDiscovered: z.number(),
  pagesCrawled: z.number(),
  startedAt: z.coerce.string().nullable(),
  finishedAt: z.coerce.string().nullable(),
  createdAt: z.coerce.string(),
});

/** GET crawls — list + total (KPI "จำนวน Crawl") + echo paging. */
export const crawlListSchema = z.object({
  items: z.array(crawlListItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export class CrawlListDto extends createZodDto(crawlListSchema) {}
