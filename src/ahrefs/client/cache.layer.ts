import { Inject, Injectable } from '@nestjs/common';
import { REDIS } from '../../redis/redis.module';
import type { RedisClient } from '../../redis/redis.module';
import { AhrefsRepo } from '../ahrefs.repo';
import type { UpsertCacheInput } from '../ahrefs.repo';

/** TTL ของ hot cache (Redis) — เพดาน 1 ชม. (เอกสาร 03 §6); durable อยู่ที่ ahrefs_cache. */
const HOT_TTL_SEC = 3600;

/**
 * CacheLayer (เอกสาร 03 §6) — สองชั้น: Redis (hot, เร็ว) → ahrefs_cache (durable, ตาม TTL).
 * อ่าน hot ก่อน; miss → durable; เจอใน durable ก็เติม hot กลับ. กัน units บานจากการยิงซ้ำ.
 */
@Injectable()
export class CacheLayer {
  constructor(
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly repo: AhrefsRepo,
  ) {}

  private hotKey(paramsHash: string): string {
    return `ahrefs:c:${paramsHash}`;
  }

  /** คืน response ที่ cache ไว้ (hot → durable) หรือ null ถ้าไม่มี/หมดอายุ. */
  async get(endpoint: string, paramsHash: string): Promise<unknown> {
    const hot = await this.redis.get(this.hotKey(paramsHash));
    if (hot) return JSON.parse(hot);

    const row = await this.repo.findFreshCache(endpoint, paramsHash);
    if (row) {
      await this.redis.setex(
        this.hotKey(paramsHash),
        HOT_TTL_SEC,
        JSON.stringify(row.response),
      );
      return row.response;
    }
    return null;
  }

  /** เขียนผลลง durable (ahrefs_cache) + hot (TTL = min(ttl, 1ชม.)). */
  async set(input: UpsertCacheInput): Promise<void> {
    await this.repo.upsertCache(input);
    await this.redis.setex(
      this.hotKey(input.paramsHash),
      Math.min(input.ttlSec, HOT_TTL_SEC),
      JSON.stringify(input.response),
    );
  }
}
