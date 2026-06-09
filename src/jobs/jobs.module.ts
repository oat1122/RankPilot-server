import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

/**
 * JobsModule (api side, producer) — รวมสถานะงานทุกคิวให้ FE (เอกสาร 00 §4).
 * register ทั้ง 4 คิว (ชื่อเดิมของ domain อื่น) เพื่อ inject เข้า JobsService อ่านสถานะ;
 * register ซ้ำชื่อเดิมคืน Queue เดิม (ไม่สร้างคิวใหม่). DB token = @Global (scope owner).
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'crawl' },
      { name: 'ahrefs' },
      { name: 'analysis' },
      { name: 'ai' },
    ),
  ],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
