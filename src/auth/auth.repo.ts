import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import { users } from '../db/schema';
import { AppException, ErrorCode } from '../common/http';
import type { AuthUser, UserRole } from './auth-user';

/** คอลัมน์ที่ดึงมาประกอบ AuthUser + เช็ค status (resolve flow). */
const userCols = {
  id: users.id,
  clerkUserId: users.clerkUserId,
  email: users.email,
  role: users.role,
  status: users.status,
};
type UserRow = {
  id: number;
  clerkUserId: string | null;
  email: string;
  role: UserRole;
  status: 'active' | 'disabled';
};

/**
 * AuthRepo — map Clerk identity → users row ภายใน (เอกสาร 05 §4). "ไม่มี self sign-up": แทนที่
 * JIT upsert เดิม ด้วย allowlist resolve — เข้าได้เฉพาะคนที่ admin เชิญไว้ (match by email แล้ว
 * bind clerk id ครั้งแรก) หรืออยู่ใน ADMIN_EMAILS (bootstrap admin, ส่งมาเป็น provisionAsAdmin).
 * คนที่ไม่อยู่ allowlist → USER_NOT_PROVISIONED; ถูก soft-disable → USER_DISABLED.
 * policy "ใครเป็น admin" คำนวณที่ ClerkAuthGuard (อ่าน ADMIN_EMAILS) แล้วส่ง flag เข้ามา —
 * repo รับผิดชอบเฉพาะ DB. inject DB token (@Global) เหมือน repo อื่น ๆ.
 */
@Injectable()
export class AuthRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * resolve identity (จาก token/dev-bypass) → AuthUser. ลำดับ:
   *  1) เจอด้วย clerk id (user เดิมที่เคย login)
   *  2) เจอ invite ด้วย email (admin สร้างไว้, clerk id ยังว่าง) → bind clerk id
   *  3) ยังไม่มี + provisionAsAdmin (ADMIN_EMAILS/dev) → สร้าง admin (active) อัตโนมัติ
   *  4) ไม่เข้าข้อใด → ปฏิเสธ (ปิด self sign-up)
   * แล้วกัน disabled + ยกระดับเป็น admin ถ้า allowlist บอก (env authority เหนือ DB).
   */
  async resolveUser(p: {
    clerkUserId: string;
    email: string | null;
    provisionAsAdmin: boolean;
  }): Promise<AuthUser> {
    const email = p.email?.trim().toLowerCase() || null;

    let row = await this.findByClerk(p.clerkUserId);

    if (!row && email) {
      const invite = await this.findByEmail(email);
      // bind เฉพาะ invite ที่ยังไม่ผูก clerk id (กันแย่ง identity ของ row ที่ผูกคนอื่นแล้ว)
      if (invite && invite.clerkUserId === null) {
        await this.bindClerkId(invite.id, p.clerkUserId);
        row = { ...invite, clerkUserId: p.clerkUserId };
      } else if (invite) {
        row = invite;
      }
    }

    if (!row && p.provisionAsAdmin && email)
      row = await this.createAdmin(p.clerkUserId, email);

    if (!row)
      throw new AppException(
        ErrorCode.USER_NOT_PROVISIONED,
        'บัญชีนี้ยังไม่ได้รับอนุญาตให้เข้าใช้งาน — ติดต่อผู้ดูแลระบบ',
      );

    if (row.status === 'disabled')
      throw new AppException(
        ErrorCode.USER_DISABLED,
        'บัญชีนี้ถูกระงับการใช้งาน',
      );

    let role = row.role;
    if (p.provisionAsAdmin && role !== 'admin') {
      await this.setRole(row.id, 'admin');
      role = 'admin';
    }

    return {
      id: row.id,
      clerkUserId: p.clerkUserId,
      email: row.email,
      role,
    };
  }

  private async findByClerk(clerkUserId: string): Promise<UserRow | null> {
    const rows = await this.db
      .select(userCols)
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1);
    return rows[0] ?? null;
  }

  private async findByEmail(email: string): Promise<UserRow | null> {
    const rows = await this.db
      .select(userCols)
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return rows[0] ?? null;
  }

  /** ผูก clerk id เข้ากับ invite row ที่ user login ครั้งแรก (เดิม clerk_user_id = NULL). */
  private async bindClerkId(id: number, clerkUserId: string): Promise<void> {
    await this.db.update(users).set({ clerkUserId }).where(eq(users.id, id));
  }

  /** bootstrap: สร้าง admin ใหม่ (active) เมื่อ email ∈ ADMIN_EMAILS แต่ยังไม่มีใน DB. */
  private async createAdmin(
    clerkUserId: string,
    email: string,
  ): Promise<UserRow> {
    const [{ id }] = await this.db
      .insert(users)
      .values({ clerkUserId, email, role: 'admin', status: 'active' })
      .$returningId();
    return { id, clerkUserId, email, role: 'admin', status: 'active' };
  }

  private async setRole(id: number, role: UserRole): Promise<void> {
    await this.db.update(users).set({ role }).where(eq(users.id, id));
  }
}
