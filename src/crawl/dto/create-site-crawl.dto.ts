import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * body ของ POST /projects/:projectId/crawls — site crawl ทั้งเว็บ (sitemap + BFS).
 * maxPages = เพดานจำนวนหน้าที่ผู้ใช้กรอก (default 50). .max(1000) = ceiling แบบหยาบกัน payload
 * เพี้ยน; เพดานจริง (env CRAWLER_SITE_MAX_PAGES, default 200) ตรวจที่ CrawlService.enqueueSite
 * แล้ว throw VALIDATION_FAILED ถ้าเกิน (∵ DTO static อ่าน ConfigService ไม่ได้) — worker ยัง cap
 * ซ้ำด้วย env เป็น defense กัน runaway. domain เอาจาก project (ไม่รับจาก body).
 */
export const createSiteCrawlSchema = z.object({
  maxPages: z.coerce.number().int().min(1).max(1000).default(50),
});

export class CreateSiteCrawlDto extends createZodDto(createSiteCrawlSchema) {}
