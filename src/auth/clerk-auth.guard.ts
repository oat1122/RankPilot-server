import { Injectable, Logger } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException, ErrorCode } from '../common/http';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ClerkTokenVerifier } from './clerk-token-verifier';
import { AuthRepo } from './auth.repo';
import type { AuthUser } from './auth-user';

/** dev user คงที่ตอนไม่มี CLERK_SECRET_KEY (dev/test) — ผูก JIT users row เดียว. */
const DEV_CLERK_USER_ID = 'dev_user';
const DEV_EMAIL = 'dev@rankpilot.local';

/**
 * ClerkAuthGuard — global guard (secure-by-default, เอกสาร 05 §4). ลงทะเบียนเป็น APP_GUARD
 * ใน app.module → ทุก endpoint บังคับ Bearer ยกเว้นที่ mark @Public (/health).
 *
 * โหมด:
 *  - มี CLERK_SECRET_KEY → verify token จริง (ClerkTokenVerifier) ทุก env.
 *  - ไม่มี (dev/test) → dev-bypass: inject dev user เพื่อให้แอป/jest รันได้โดยไม่ต้องตั้ง Clerk.
 *    prod ถูกกันที่ boot แล้ว (validateEnv บังคับ key) จึงไม่ตกมา bypass จริง — กันซ้ำที่นี่อีกชั้น.
 *
 * ผ่านแล้ว upsert users (JIT) → แนบ req.user (AuthUser). cache clerkUserId→AuthUser ใน memory
 * กัน upsert ซ้ำทุก request (โดยเฉพาะ dev user). req.user ถูกใช้โดย @CurrentUser + ProjectAccessGuard.
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);
  private readonly userCache = new Map<string, AuthUser>();
  private devBypassWarned = false;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly verifier: ClerkTokenVerifier,
    private readonly repo: AuthRepo,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    req.user = await this.authenticate(req);
    return true;
  }

  /** verify/bypass → resolve เป็น AuthUser (ผ่าน cache + JIT upsert). */
  private async authenticate(req: Request): Promise<AuthUser> {
    const { clerkUserId, email } = await this.resolveIdentity(req);
    const cached = this.userCache.get(clerkUserId);
    if (cached) return cached;
    const user = await this.repo.upsertUser(clerkUserId, email);
    this.userCache.set(clerkUserId, user);
    return user;
  }

  /** ตัดสิน clerkUserId/email จาก token (verify) หรือ dev-bypass. */
  private async resolveIdentity(
    req: Request,
  ): Promise<{ clerkUserId: string; email: string | null }> {
    const hasKey = !!this.config.get<string>('CLERK_SECRET_KEY');
    if (hasKey) {
      const token = this.bearer(req);
      if (!token)
        throw new AppException(
          ErrorCode.UNAUTHORIZED,
          'ต้องแนบ Authorization: Bearer <token> (Clerk)',
        );
      return this.verifier.verify(token);
    }
    // ไม่มี key: prod ไม่ควรมาถึง (boot ล้มไปแล้ว) — กันพลาดด้วยการปฏิเสธ ไม่ปล่อย bypass จริง.
    if (this.config.get<string>('NODE_ENV') === 'production')
      throw new AppException(ErrorCode.UNAUTHORIZED, 'auth not configured');
    if (!this.devBypassWarned) {
      this.devBypassWarned = true;
      this.logger.warn(
        'CLERK_SECRET_KEY ไม่ได้ตั้ง — เข้าโหมด dev-bypass (inject dev user). ห้ามใช้ production.',
      );
    }
    return { clerkUserId: DEV_CLERK_USER_ID, email: DEV_EMAIL };
  }

  /** ดึง token จาก `Authorization: Bearer <token>`. */
  private bearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }
}
