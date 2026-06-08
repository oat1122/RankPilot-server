import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth-user';

/**
 * inject AuthUser ที่ ClerkAuthGuard แนบไว้ที่ req.user (เอกสาร 05 §4).
 * ใช้ใน controller: `list(@CurrentUser() user: AuthUser)`. ต้องอยู่หลัง guard (global) เสมอ
 * จึงมีค่าแน่นอนบน endpoint ที่ไม่ใช่ @Public.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return req.user as AuthUser;
  },
);
