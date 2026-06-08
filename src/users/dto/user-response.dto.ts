import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { USER_ROLES } from '../../auth/auth-user';

/**
 * Response shapes ของ /users/* — Zod เดียว (เอกสาร 04 §6) document `data` ใน envelope ให้ TS
 * client ฝั่ง web เห็น type จริง. clerkUserId nullable (invite ที่ยังไม่ login). createdAt coerce
 * เป็น string (DB คืน Date).
 */
export const userSchema = z.object({
  id: z.number(),
  email: z.string(),
  role: z.enum(USER_ROLES),
  status: z.enum(['active', 'disabled']),
  clerkUserId: z.string().nullable(),
  createdAt: z.coerce.string(),
});
export class UserDto extends createZodDto(userSchema) {}

/** GET /users — list ทั้งหมด (admin). */
export const userListSchema = z.object({
  items: z.array(userSchema),
});
export class UserListDto extends createZodDto(userListSchema) {}
