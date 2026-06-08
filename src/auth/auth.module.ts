import { Global, Module } from '@nestjs/common';
import { ClerkTokenVerifier } from './clerk-token-verifier';
import { AuthRepo } from './auth.repo';
import { RolesGuard } from './roles.guard';

/**
 * AuthModule — providers ของ auth layer (เอกสาร 05 §4). ClerkAuthGuard เองลงทะเบียนเป็น
 * APP_GUARD ใน app.module (เพื่อคุมลำดับกับ ThrottlerGuard) จึง export verifier+repo ให้
 * AppModule สร้าง guard ได้. @Global + export RolesGuard → โดเมนอื่น @UseGuards(RolesGuard)
 * ได้โดยไม่ import (แพทเทิร์นเดียวกับ ProjectsModule/ProjectAccessGuard). DB token มาจาก DbModule (@Global).
 */
@Global()
@Module({
  providers: [ClerkTokenVerifier, AuthRepo, RolesGuard],
  exports: [ClerkTokenVerifier, AuthRepo, RolesGuard],
})
export class AuthModule {}
