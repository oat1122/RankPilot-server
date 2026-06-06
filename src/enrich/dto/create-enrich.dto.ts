import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Body ของ POST /projects/:projectId/ahrefs/enrich — ทั้งสอง field optional:
 * domain/budget มาจาก projects (โหลดใน service), เหลือ override country + จำนวนแถว.
 * limit เพดาน 100 แต่ Lite จริง ~10 rows/request (เอกสาร 03 §0) — default ตั้งใน service.
 */
export const createEnrichSchema = z.object({
  country: z.string().length(2).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export class CreateEnrichDto extends createZodDto(createEnrichSchema) {}
