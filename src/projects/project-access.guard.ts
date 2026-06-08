import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DB } from '../db/db.module';
import type { Db } from '../db/db.module';
import { projects } from '../db/schema';
import { AppException, ErrorCode } from '../common/http';
import type { AuthUser } from '../auth/auth-user';

/**
 * ProjectAccessGuard — บังคับว่า caller เป็นเจ้าของ :projectId บน route (multi-tenant, เอกสาร 05 §4).
 * วางหลัง global ClerkAuthGuard (req.user พร้อมแล้ว) ผ่าน @UseGuards(ProjectAccessGuard) บน
 * controller/route ที่มี :projectId. exported จาก ProjectsModule (@Global) → domain อื่น
 * (crawls/trends/analysis/ai/enrich) reuse ได้โดยไม่ต้อง import. ไม่ใช่เจ้าของ/ไม่มี → 404
 * PROJECT_NOT_FOUND (ไม่ใช่ 403) เพื่อไม่เปิดเผยว่า projectId มีจริง.
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    const rawProjectId = String(req.params.projectId ?? '');
    const projectId = Number(rawProjectId);
    if (!Number.isInteger(projectId) || projectId <= 0)
      throw new AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        `project ${rawProjectId} not found`,
      );

    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, user.id)))
      .limit(1);
    if (rows.length === 0)
      throw new AppException(
        ErrorCode.PROJECT_NOT_FOUND,
        `project ${projectId} not found`,
      );
    return true;
  }
}
