import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { validateEnv } from '../config/env';
import { bullRootAsyncOptions } from '../queue/bull.config';
import { CrawlerModule } from '../crawler/crawler.module';
import { CrawlProcessor } from './crawl.processor';
import { AhrefsModule } from '../ahrefs/ahrefs.module';
import { AhrefsProcessor } from './ahrefs.processor';

/**
 * Root module ของ worker process (apps/worker ในอนาคต — เอกสาร 04 §0).
 * แยกจาก AppModule (api) โดยสิ้นเชิง: ที่นี่เท่านั้นที่ register WorkerHost (consumer).
 * consumer: 'crawl' (CrawlProcessor) + 'ahrefs' (AhrefsProcessor, เอกสาร 03 §5).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    BullModule.forRootAsync(bullRootAsyncOptions),
    BullModule.registerQueue({ name: 'crawl' }),
    BullModule.registerQueue({ name: 'ahrefs' }),
    CrawlerModule,
    AhrefsModule,
  ],
  providers: [CrawlProcessor, AhrefsProcessor],
})
export class WorkerModule {}
