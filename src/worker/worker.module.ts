import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { validateEnv } from '../config/env';
import { bullRootAsyncOptions } from '../queue/bull.config';
import { CrawlerModule } from '../crawler/crawler.module';
import { CrawlProcessor } from './crawl.processor';

/**
 * Root module ของ worker process (apps/worker ในอนาคต — เอกสาร 04 §0).
 * แยกจาก AppModule (api) โดยสิ้นเชิง: ที่นี่เท่านั้นที่ register WorkerHost (consumer).
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
    CrawlerModule,
  ],
  providers: [CrawlProcessor],
})
export class WorkerModule {}
