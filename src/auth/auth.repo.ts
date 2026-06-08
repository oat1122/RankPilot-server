import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import { users } from '../db/schema';
import type { AuthUser } from './auth-user';

/**
 * AuthRepo — map Clerk user → users row ภายใน (เอกสาร 01 §2 / 05 §4). JIT provisioning:
 * ครั้งแรกที่ token ผ่าน guard จะ upsert users (clerk_user_id unique = uq_users_clerk) แล้วคืน
 * id ภายใน (ใช้เป็น projects.ownerId). inject DB token (@Global) เหมือน repo อื่น ๆ.
 */
@Injectable()
export class AuthRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * upsert users ตาม clerkUserId แล้วคืน AuthUser. email เป็น notNull → fallback ถ้า claim ว่าง
   * (session token มาตรฐานไม่มี email เว้นแต่ตั้ง JWT template). อัปเดต email เฉพาะตอนมี claim
   * จริงเพื่อไม่ทับ email จริงด้วย placeholder (กรณีไม่มี claim = no-op set clerk_user_id เดิม).
   */
  async upsertUser(
    clerkUserId: string,
    email: string | null,
  ): Promise<AuthUser> {
    const resolvedEmail = email ?? `${clerkUserId}@clerk.local`;
    await this.db
      .insert(users)
      .values({ clerkUserId, email: resolvedEmail })
      .onDuplicateKeyUpdate({ set: email ? { email } : { clerkUserId } });

    const rows = await this.db
      .select({
        id: users.id,
        clerkUserId: users.clerkUserId,
        email: users.email,
      })
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1);
    return rows[0];
  }
}
