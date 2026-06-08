import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * body ของ POST /projects (เอกสาร 01 §2 projects). Zod เดียวเป็น source of truth.
 * domain = target ของ Ahrefs (hostname เปล่า ไม่มี scheme/path) — refine กันใส่ URL เต็ม
 * เพราะ enrichment join ด้วย domain ตรง ๆ (เอกสาร 03).
 */
export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((d) => !/^https?:\/\//i.test(d) && !d.includes('/'), {
      message:
        'domain ต้องเป็น hostname เปล่า (เช่น example.com) ไม่ใส่ http(s):// หรือ path',
    }),
  country: z.string().length(2).default('th'),
});

export class CreateProjectDto extends createZodDto(createProjectSchema) {}
