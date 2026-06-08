import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException, ErrorCode } from '../common/http';
import { ROLES_KEY } from './roles.decorator';
import type { AuthUser, UserRole } from './auth-user';

/**
 * RolesGuard — บังคับ role ตาม @Roles (RBAC ขั้นต้น, เอกสาร 05 §4). วางหลัง global ClerkAuthGuard
 * (req.user + role พร้อมแล้ว) ผ่าน @UseGuards(RolesGuard) บน controller/route. ไม่มี @Roles =
 * ไม่จำกัด (ผ่าน). role ไม่ตรง → 403 FORBIDDEN. exported จาก AuthModule (@Global) → reuse ได้ทุก
 * โดเมนโดยไม่ต้อง import (แพทเทิร์นเดียวกับ ProjectAccessGuard).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    // global guard รันก่อนเสมอ — ถ้าไม่มี user แปลว่าใช้ guard ผิดลำดับ (กันพลาด).
    if (!user)
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'missing authenticated user',
      );

    if (!required.includes(user.role))
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'ต้องมีสิทธิ์ระดับ admin สำหรับการดำเนินการนี้',
      );
    return true;
  }
}
