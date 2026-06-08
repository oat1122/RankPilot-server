import { SetMetadata } from '@nestjs/common';

/** metadata key ที่ ClerkAuthGuard อ่านเพื่อข้าม auth. */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * mark endpoint เป็น public — ClerkAuthGuard ไม่บังคับ Bearer (เอกสาร 05 §4).
 * ตอนนี้ใช้กับ /health เท่านั้น (secure-by-default: ที่เหลือบังคับ auth หมด).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
