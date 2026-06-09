import { Module } from '@nestjs/common';
import { PagesController } from './pages.controller';
import { PagesService } from './pages.service';
import { PagesRepo } from './pages.repo';

/**
 * Domain 'pages' (api, read-only) — list หน้าที่ crawl มา + page detail สำหรับ dashboard ใหม่.
 * ProjectAccessGuard มาจาก ProjectsModule (@Global) → ไม่ต้อง import. DB ผ่าน token @Global.
 */
@Module({
  controllers: [PagesController],
  providers: [PagesService, PagesRepo],
})
export class PagesModule {}
