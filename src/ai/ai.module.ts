import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { AiEngineModule } from './ai.engine.module';
import { AiController } from './ai.controller';
import { AiConfigController } from './ai-config.controller';
import { AiService } from './ai.service';
import { AiConfigService } from './ai-config.service';

/**
 * Domain 'ai' ฝั่ง api (producer) — register queue 'ai' + controllers + read/config endpoints.
 * import AiEngineModule เพื่อใช้ AiRepo + AiConfigRepo (settings/skills). การรัน graph จริงอยู่ใน
 * worker (AiProcessor) ตามกฎ api ≠ worker (เอกสาร 00 §4). HttpModule → AiConfigService (proxy
 * รายการ model ของ OpenRouter — Phase 5 §3).
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
    HttpModule,
    AiEngineModule,
  ],
  controllers: [AiController, AiConfigController],
  providers: [AiService, AiConfigService],
})
export class AiModule {}
