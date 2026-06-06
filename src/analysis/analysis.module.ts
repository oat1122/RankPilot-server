import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AnalysisEngineModule } from './analysis.engine.module';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';

/**
 * Domain 'analysis' ฝั่ง api (producer) — register queue 'analysis' + controller + read
 * endpoints. import AnalysisEngineModule เพื่อใช้ AnalysisRepo (ตรวจ project + อ่าน findings/
 * scores). การคำนวณจริงอยู่ใน worker (AnalysisProcessor) ตามกฎ api ≠ worker (เอกสาร 00 §4).
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'analysis',
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
    AnalysisEngineModule,
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService],
})
export class AnalysisModule {}
