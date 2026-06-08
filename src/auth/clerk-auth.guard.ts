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

/** dev user คงที่ตอนไม่มี CLERK_SECRET_KEY (dev/test) — ผูก users row เดียว (เป็น admin ให้ทดสอบ /users). */
const DEV_CLERK_USER_ID = 'dev_user';
const DEV_EMAIL = 'dev@rankpilot.local';

/**
 * ClerkAuthGuard — global guard (secure-by-default, เอกสาร 05 §4). ลงทะเบียนเป็น APP_GUARD
 * ใน app.module → ทุก endpoint บังคับ Bearer ยกเว้นที่ mark @Public (/health).
 *
 * โหมด:
 *  - มี CLERK_SECRET_KEY → verify token จริง (ClerkTokenVerifier) ทุก env.
 *  - ไม่มี (dev/test) → dev-bypass: inject dev user (admin) เพื่อให้แอป/jest รันได้โดยไม่ต้องตั้ง Clerk.
 *    prod ถูกกันที่ boot แล้ว (validateEnv บังคับ key) จึงไม่ตกมา bypass จริง — กันซ้ำที่นี่อีกชั้น.
 *
 * "ไม่มี self sign-up": ผ่าน verify แล้วส่งให้ AuthRepo.resolveUser แบบ allowlist (เชิญด้วย email /
 * อยู่ใน ADMIN_EMAILS เท่านั้น) → แนบ req.user (AuthUser พร้อม role). guard คำนวณ provisionAsAdmin
 * (dev-bypass หรือ email ∈ ADMIN_EMAILS) ส่งเป็น policy ให้ repo. ไม่มี cache แล้ว — resolveUser =
 * SELECT แบบ index ต่อ request → disable/เปลี่ยน role มีผลทันที (ไม่ค้างใน memory ข้าม process).
 * req.user ถูกใช้โดย @CurrentUser + ProjectAccessGuard + RolesGuard.
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);
  private adminEmails: Set<string> | null = null;
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

  /** verify/bypass → resolve เป็น AuthUser ผ่าน allowlist (provisionAsAdmin = dev/ADMIN_EMAILS). */
  private async authenticate(req: Request): Promise<AuthUser> {
    const { clerkUserId, email, devBypass } = await this.resolveIdentity(req);
    const provisionAsAdmin = devBypass || this.isAdminEmail(email);
    return this.repo.resolveUser({ clerkUserId, email, provisionAsAdmin });
  }

  /** ตัดสิน clerkUserId/email จาก token (verify) หรือ dev-bypass. */
  private async resolveIdentity(req: Request): Promise<{
    clerkUserId: string;
    email: string | null;
    devBypass: boolean;
  }> {
    const hasKey = !!this.config.get<string>('CLERK_SECRET_KEY');
    if (hasKey) {
      const token = this.bearer(req);
      if (!token)
        throw new AppException(
          ErrorCode.UNAUTHORIZED,
          'ต้องแนบ Authorization: Bearer <token> (Clerk)',
        );
      const id = await this.verifier.verify(token);
      return { ...id, devBypass: false };
    }
    // ไม่มี key: prod ไม่ควรมาถึง (boot ล้มไปแล้ว) — กันพลาดด้วยการปฏิเสธ ไม่ปล่อย bypass จริง.
    if (this.config.get<string>('NODE_ENV') === 'production')
      throw new AppException(ErrorCode.UNAUTHORIZED, 'auth not configured');
    if (!this.devBypassWarned) {
      this.devBypassWarned = true;
      this.logger.warn(
        'CLERK_SECRET_KEY ไม่ได้ตั้ง — เข้าโหมด dev-bypass (inject dev admin). ห้ามใช้ production.',
      );
    }
    return {
      clerkUserId: DEV_CLERK_USER_ID,
      email: DEV_EMAIL,
      devBypass: true,
    };
  }

  /** email ∈ ADMIN_EMAILS (comma-sep, case-insensitive) — parse ครั้งเดียวแล้ว cache. */
  private isAdminEmail(email: string | null): boolean {
    if (!email) return false;
    if (!this.adminEmails) {
      const raw = this.config.get<string>('ADMIN_EMAILS') ?? '';
      this.adminEmails = new Set(
        raw
          .split(',')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      );
    }
    return this.adminEmails.has(email.trim().toLowerCase());
  }

  /** ดึง token จาก `Authorization: Bearer <token>`. */
  private bearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }
}
