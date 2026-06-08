import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiEngineModule } from './ai.engine.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

/**
 * Domain 'ai' ฝั่ง api (producer) — register queue 'ai' + controller + read endpoint.
 * import AiEngineModule เพื่อใช้ AiRepo (ตรวจ project + resolve pages + อ่าน recommendations).
 * การรัน graph จริงอยู่ใน worker (AiProcessor) ตามกฎ api ≠ worker (เอกสาร 00 §4).
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'ai',
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
    AiEngineModule,
  ],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
