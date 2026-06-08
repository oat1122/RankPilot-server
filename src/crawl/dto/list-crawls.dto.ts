import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * query ของ GET /projects/:projectId/crawls — paging + filter status. coerce จาก string
 * (query string มาเป็น string เสมอ). limit เพดาน 100 กันดึงทีละมาก ๆ.
 */
export const listCrawlsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
  status: z.enum(['queued', 'running', 'done', 'failed', 'partial']).optional(),
});

export class ListCrawlsQueryDto extends createZodDto(listCrawlsQuerySchema) {}
