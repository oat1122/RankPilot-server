import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response shapes ของ /projects/* — Zod เดียว (เอกสาร 04 §6) document `data` ใน envelope
 * ให้ TS client ฝั่ง web เห็น type จริง. createdAt coerce เป็น string (DB คืน Date).
 */
export const projectSchema = z.object({
  id: z.number(),
  name: z.string(),
  domain: z.string(),
  country: z.string(),
  monthlyUnitBudget: z.number(),
  createdAt: z.coerce.string(),
});
export class ProjectDto extends createZodDto(projectSchema) {}

/** GET /projects — list ของ user ปัจจุบัน (project switcher). */
export const projectListSchema = z.object({
  items: z.array(projectSchema),
});
export class ProjectListDto extends createZodDto(projectListSchema) {}
