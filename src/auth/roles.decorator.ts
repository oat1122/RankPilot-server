import { SetMetadata } from '@nestjs/common';
import type { UserRole } from './auth-user';

/**
 * @Roles(...roles) — ระบุ role ที่เข้าถึง route ได้ (เอกสาร 05 §4). อ่านโดย RolesGuard.
 * วางที่ class (default ทั้ง controller) หรือ method (override เฉพาะ route). ไม่ใส่ = ไม่จำกัด role.
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
