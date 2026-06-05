import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CrawlController } from './crawl.controller';
import { CrawlService } from './crawl.service';

/**
 * Domain 'crawl' ฝั่ง api (producer) — register queue 'crawl' (เอกสาร 03 §1).
 * defaultJobOptions: retry 2 ครั้ง + เก็บผลล่าสุดไว้พอประมาณ กัน Redis บวม.
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'crawl',
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
  ],
  controllers: [CrawlController],
  providers: [CrawlService],
})
export class CrawlModule {}
