/**
 * ผู้ใช้ที่ผ่าน auth แล้ว — ClerkAuthGuard แนบไว้ที่ req.user (เอกสาร 05 §4).
 * `id` = users.id ภายใน (ใช้เป็น projects.ownerId เพื่อ scope ข้อมูลต่อ tenant) ไม่ใช่ clerkUserId.
 * ดึงใน controller ผ่าน @CurrentUser().
 */
export interface AuthUser {
  id: number;
  clerkUserId: string;
  email: string;
}
