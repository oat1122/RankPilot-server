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
    // verifyToken คืน { data } | { errors } (ไม่ throw) — แปลง error เป็น 401 ผ่าน envelope กลาง.
    const result = await verifyToken(token, {
      secretKey,
      authorizedParties: this.authorizedParties(),
    });
    if (result.errors) {
      // errors เป็น TokenVerificationError ที่ type resolve ไม่ได้ (error-typed) → cast อ่าน message
      const reason =
        (result.errors[0] as { message?: string } | undefined)?.message ??
        'invalid token';
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        `token ไม่ผ่านการตรวจสอบ (Clerk): ${reason}`,
      );
    }
    // claims อ่านแบบ defensive: sub = user id (มาตรฐาน), email = custom claim (มีเฉพาะถ้า
    // ตั้ง JWT template). type ของ data หลวม (JwtPayload re-export) → cast เป็น record.
    const claims = result.data as Record<string, unknown>;
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
