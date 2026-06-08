import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * query ของ /trends/* — ช่วงวันที่ (YYYY-MM-DD, optional). ไม่ส่ง = 30 วันล่าสุด (คำนวณใน
 * service). regex แทน z.date() ∵ query string มาเป็น string + ต้องการรูป YYYY-MM-DD ชัด ๆ.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'ต้องเป็นรูปแบบ YYYY-MM-DD');

export const trendsQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export class TrendsQueryDto extends createZodDto(trendsQuerySchema) {}
