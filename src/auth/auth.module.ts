import { Module } from '@nestjs/common';
import { ClerkTokenVerifier } from './clerk-token-verifier';
import { AuthRepo } from './auth.repo';

/**
 * AuthModule — providers ของ auth layer (เอกสาร 05 §4). ClerkAuthGuard เองลงทะเบียนเป็น
 * APP_GUARD ใน app.module (เพื่อคุมลำดับกับ ThrottlerGuard) จึง export verifier+repo ให้
 * AppModule สร้าง guard ได้. DB token มาจาก DbModule (@Global).
 */
@Module({
  providers: [ClerkTokenVerifier, AuthRepo],
  exports: [ClerkTokenVerifier, AuthRepo],
})
export class AuthModule {}
