import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import { AppException, ErrorCode } from '../common/http';

/** claim ที่ guard ต้องใช้จาก session token (sub + email ถ้า JWT template ใส่มา). */
export interface VerifiedClerkToken {
  clerkUserId: string;
  email: string | null;
}

/**
 * ClerkTokenVerifier — ห่อ @clerk/backend `verifyToken` (เอกสาร 05 §4) ให้ ClerkAuthGuard.
 * แยกเป็น provider เพื่อ mock ได้ใน unit test (ไม่ต้องยิง Clerk จริง). อ่าน secret/azp ผ่าน
 * ConfigService (ไม่ใช่ process.env ตรง — เอกสาร 00 §1). เรียกเฉพาะตอนมี CLERK_SECRET_KEY
 * (guard เป็นคนคุม) → secretKey ไม่เคยเป็น undefined ตอน runtime.
 */
@Injectable()
export class ClerkTokenVerifier {
  constructor(private readonly config: ConfigService) {}

  async verify(token: string): Promise<VerifiedClerkToken> {
    const secretKey = this.config.get<string>('CLERK_SECRET_KEY');
    // @clerk/backend export `verifyToken` แบบ withLegacyReturn → คืน JwtPayload (claims) ตรง ๆ
    // และ **throw** ทุกกรณีที่ verify ไม่ผ่าน (หมดอายุ/ลายเซ็น/azp/รูปแบบ JWT พัง) — ไม่ใช่
    // { data, errors } ∴ ครอบ try/catch แปลงเป็น 401 (ไม่งั้นหลุดเป็น 500 ผ่าน AllExceptionsFilter).
    let claims: Record<string, unknown>;
    try {
      claims = (await verifyToken(token, {
        secretKey,
        authorizedParties: this.authorizedParties(),
      })) as Record<string, unknown>;
    } catch (err) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        `token ไม่ผ่านการตรวจสอบ (Clerk): ${
          (err as { message?: string } | undefined)?.message ?? 'invalid token'
        }`,
      );
    }
    // claims อ่านแบบ defensive: sub = user id (มาตรฐาน), email = custom claim (มีเฉพาะถ้าตั้ง
    // "Customize session token" ให้ใส่ email). JwtPayload type หลวม → cast เป็น record แล้วเช็คเอง.
    const sub = typeof claims.sub === 'string' ? claims.sub : null;
    if (!sub)
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'token ไม่มี sub (subject) — ไม่ใช่ session token ที่ถูกต้อง',
      );
    const email = typeof claims.email === 'string' ? claims.email : null;
    return { clerkUserId: sub, email };
  }

  /** parse CLERK_AUTHORIZED_PARTIES (comma-sep) → array | undefined (ว่าง = ไม่ตรวจ azp). */
  private authorizedParties(): string[] | undefined {
    const raw = this.config.get<string>('CLERK_AUTHORIZED_PARTIES');
    if (!raw) return undefined;
    const parties = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parties.length ? parties : undefined;
  }
}
