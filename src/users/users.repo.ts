import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ne } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import { users } from '../db/schema';
import type { UserRole } from '../auth/auth-user';

const userCols = {
  id: users.id,
  email: users.email,
  role: users.role,
  status: users.status,
  clerkUserId: users.clerkUserId,
  createdAt: users.createdAt,
};

/**
 * UsersRepo — data access ของ UserManager (เอกสาร 05 §4). create = invite (clerk_user_id NULL,
 * status active) → bind clerk id ตอน login ครั้งแรก (AuthRepo.resolveUser). inject DB token (@Global).
 */
@Injectable()
export class UsersRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  list() {
    return this.db.select(userCols).from(users).orderBy(desc(users.createdAt));
  }

  async findById(id: number) {
    const rows = await this.db
      .select(userCols)
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByEmail(email: string) {
    const rows = await this.db
      .select(userCols)
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(email: string, role: UserRole) {
    const [{ id }] = await this.db
      .insert(users)
      .values({ email, role, status: 'active' })
      .$returningId();
    return this.findById(id);
  }

  async updateFields(
    id: number,
    fields: { role?: UserRole; status?: 'active' | 'disabled' },
  ) {
    await this.db.update(users).set(fields).where(eq(users.id, id));
    return this.findById(id);
  }

  /** จำนวน admin ที่ยัง active (ไม่นับ excludeId) — ใช้กันลบ/ลดสิทธิ์ admin คนสุดท้าย. */
  async countActiveAdmins(excludeId?: number): Promise<number> {
    const where = excludeId
      ? and(
          eq(users.role, 'admin'),
          eq(users.status, 'active'),
          ne(users.id, excludeId),
        )
      : and(eq(users.role, 'admin'), eq(users.status, 'active'));
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(users)
      .where(where);
    return Number(n);
  }
}
