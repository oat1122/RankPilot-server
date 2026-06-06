import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Input ของ POST /crawls — Zod เป็น source of truth (เอกสาร 04 §6):
 * reuse ได้ทั้ง DTO (api) และ payload ของ job (worker).
 */
export const createCrawlSchema = z.object({
  // ต้องเป็น http/https เท่านั้น — z.url() เพียว ๆ ปล่อย mailto:/javascript:/ftp:/file:
  // ผ่าน ทำให้ api enqueue งานที่ crawl ไม่ได้ (worker จะ reject UNSUPPORTED_URL แล้ว fail).
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), {
      message: 'url ต้องเป็น http:// หรือ https:// เท่านั้น',
    }),
  // optional — ถ้าระบุ worker จะ persist (pages/page_snapshots/page_links) ให้ stage [3]
  // Analysis ใช้ต่อ; ไม่ระบุ = crawl เปล่า ๆ (คืนผลเฉย ๆ ไม่เขียน DB) backward-compat.
  projectId: z.coerce.number().int().positive().optional(),
});

export class CreateCrawlDto extends createZodDto(createCrawlSchema) {}
