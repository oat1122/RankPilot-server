import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DbModule } from '../db/db.module';
import { RedisModule } from '../redis/redis.module';
import { AhrefsRepo } from './ahrefs.repo';
import { BudgetGuard } from './budget.guard';
import { CacheLayer } from './cache.layer';
import { AhrefsClient } from './ahrefs.client';
import { EnrichmentService } from './enrichment.service';

/**
 * Ahrefs engine (analogous กับ crawler/) — budget service 4 ชั้น + enrichment flow.
 * imports DbModule/RedisModule (@Global) อย่าง explicit เพื่อให้ instantiate ในทุก app
 * ที่ import โมดูลนี้ (worker = consumer จริง; api ใช้แค่ BudgetGuard/AhrefsRepo ผ่าน EnrichModule).
 *
 * exports เฉพาะที่ภายนอกเรียก: EnrichmentService (worker), BudgetGuard + AhrefsRepo (api producer).
 */
@Module({
  imports: [HttpModule, DbModule, RedisModule],
  providers: [
    AhrefsRepo,
    BudgetGuard,
    CacheLayer,
    AhrefsClient,
    EnrichmentService,
  ],
  exports: [EnrichmentService, AhrefsClient, BudgetGuard, AhrefsRepo],
})
export class AhrefsModule {}
