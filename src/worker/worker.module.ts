import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { validateEnv } from '../config/env';
import { bullRootAsyncOptions } from '../queue/bull.config';
import { CrawlerModule } from '../crawler/crawler.module';
import { CrawlProcessor } from './crawl.processor';
import { AhrefsModule } from '../ahrefs/ahrefs.module';
import { AhrefsProcessor } from './ahrefs.processor';
import { AnalysisEngineModule } from '../analysis/analysis.engine.module';
import { AnalysisProcessor } from './analysis.processor';

/**
 * Root module ของ worker process (apps/worker ในอนาคต — เอกสาร 04 §0).
 * แยกจาก AppModule (api) โดยสิ้นเชิง: ที่นี่เท่านั้นที่ register WorkerHost (consumer).
 * consumer: 'crawl' (CrawlProcessor) + 'ahrefs' (AhrefsProcessor) + 'analysis'
 * (AnalysisProcessor, stage [3] เอกสาร 04 §7).
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
    BullModule.registerQueue({ name: 'analysis' }),
    CrawlerModule,
    AhrefsModule,
    AnalysisEngineModule,
  ],
  providers: [CrawlProcessor, AhrefsProcessor, AnalysisProcessor],
})
export class WorkerModule {}
