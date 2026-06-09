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
import { AiEngineModule } from '../ai/ai.engine.module';
import { AiProcessor } from './ai.processor';
import { ReportEngineModule } from '../report/report.engine.module';
import { ReportProcessor } from './report.processor';

/**
 * Root module ของ worker process (apps/worker ในอนาคต — เอกสาร 04 §0).
 * แยกจาก AppModule (api) โดยสิ้นเชิง: ที่นี่เท่านั้นที่ register WorkerHost (consumer).
 * consumer: 'crawl' (CrawlProcessor) + 'ahrefs' (AhrefsProcessor) + 'analysis'
 * (AnalysisProcessor, stage [3]) + 'ai' (AiProcessor, stage [4] เอกสาร 02) + 'report'
 * (ReportProcessor — รายงานเว็บเต็ม: Ahrefs+WHOIS+meta+AI).
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
    BullModule.registerQueue({ name: 'ai' }),
    BullModule.registerQueue({ name: 'report' }),
    CrawlerModule,
    AhrefsModule,
    AnalysisEngineModule,
    AiEngineModule,
    ReportEngineModule,
  ],
  providers: [
    CrawlProcessor,
    AhrefsProcessor,
    AnalysisProcessor,
    AiProcessor,
    ReportProcessor,
  ],
})
export class WorkerModule {}
