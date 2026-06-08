import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { USER_ROLES } from '../../auth/auth-user';

/**
 * PATCH /users/:userId — admin เปลี่ยน role และ/หรือ status (soft-disable/เปิดใหม่). ต้องระบุ
 * อย่างน้อยหนึ่งฟิลด์ (กัน PATCH เปล่า). กัน lockout (demote/disable admin คนสุดท้าย/ตัวเอง)
 * บังคับในชั้น service ไม่ใช่ที่นี่.
 */
export const updateUserSchema = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((d) => d.role !== undefined || d.status !== undefined, {
    message: 'ต้องระบุ role หรือ status อย่างน้อยหนึ่งฟิลด์',
  });

export class UpdateUserDto extends createZodDto(updateUserSchema) {}
