import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** ผลของ GET /health — ใช้ document `data` ใน envelope (เอกสาร 04 §6). */
export const healthStatusSchema = z.object({
  status: z.literal('ok'),
});

export class HealthStatusDto extends createZodDto(healthStatusSchema) {}
