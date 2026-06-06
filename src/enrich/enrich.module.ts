import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AhrefsModule } from '../ahrefs/ahrefs.module';
import { EnrichController } from './enrich.controller';
import { EnrichService } from './enrich.service';

/**
 * Domain 'enrich' ฝั่ง api (producer) — register queue 'ahrefs' (เอกสาร 03 §1/§5).
 * import AhrefsModule เพื่อใช้ BudgetGuard (endpoint /budget) + AhrefsRepo (โหลด project);
 * การยิง Ahrefs จริงอยู่ใน worker (AhrefsProcessor) ตามกฎ api ≠ worker.
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'ahrefs',
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
    AhrefsModule,
  ],
  controllers: [EnrichController],
  providers: [EnrichService],
})
export class EnrichModule {}
