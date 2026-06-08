import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { USER_ROLES } from '../../auth/auth-user';

/**
 * POST /users — admin เชิญ/สร้าง user (เอกสาร 05 §4). สร้างเป็น invite (clerk_user_id = NULL,
 * status = active); user จะถูก bind clerk id ตอน login Clerk ครั้งแรกด้วย email นี้. email
 * normalize lowercase ให้ตรงกับ resolveUser (กัน match พลาด). default role = user.
 */
export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(USER_ROLES).default('user'),
});

export class CreateUserDto extends createZodDto(createUserSchema) {}
