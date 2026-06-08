import { Module } from '@nestjs/common';
import { TrendsController } from './trends.controller';
import { TrendsService } from './trends.service';
import { TrendsRepo } from './trends.repo';

/**
 * TrendsModule [5] — read-only time-series (เอกสาร 06 P3). ProjectAccessGuard มาจาก
 * ProjectsModule (@Global) ใช้ผ่าน @UseGuards โดยไม่ต้อง import.
 */
@Module({
  controllers: [TrendsController],
  providers: [TrendsService, TrendsRepo],
})
export class TrendsModule {}
