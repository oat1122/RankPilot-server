/**
 * ผู้ใช้ที่ผ่าน auth แล้ว — ClerkAuthGuard แนบไว้ที่ req.user (เอกสาร 05 §4).
 * `id` = users.id ภายใน (ใช้เป็น projects.ownerId เพื่อ scope ข้อมูลต่อ tenant) ไม่ใช่ clerkUserId.
 * `role` = RBAC ขั้นต้น (admin/user) ใช้กับ @Roles + RolesGuard. ดึงใน controller ผ่าน @CurrentUser().
 */

/** role ที่รองรับ (แค่ 2 ก่อน) — single source ใช้ร่วม DTO/guard. ค่าตรง mysqlEnum users.role. */
export const USER_ROLES = ['admin', 'user'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface AuthUser {
  id: number;
  clerkUserId: string; // post-auth มีเสมอ (resolveUser bind clerk id แล้ว)
  email: string;
  role: UserRole;
}
