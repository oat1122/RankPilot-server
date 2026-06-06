import { Global, Logger, Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { parseRedisUrl } from '../queue/bull.config';

/**
 * Raw ioredis client (แยกจาก BullMQ) — ชั้น BudgetGuard/CacheLayer (เอกสาร 03 §5-6)
 * ต้องการ Redis command ตรง ๆ (incrby/decrby/get/setex) ซึ่ง BullMQ ไม่ได้ expose.
 * @Global — inject ได้ทุกที่ผ่าน token REDIS โดยไม่ต้อง import ซ้ำ.
 */
export const REDIS = Symbol('REDIS');

/** type ของ client ที่ inject (ใช้ตอน `@Inject(REDIS) redis: RedisClient`). */
export type RedisClient = Redis;

const REDIS_ERROR_LOG_THROTTLE_MS = 10_000;

const redisProvider: Provider = {
  provide: REDIS,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const logger = new Logger('RedisModule');
    // reuse parser ตัวเดียวกับ BullMQ (queue/bull.config) — ไม่ duplicate การแปลง URL.
    // override maxRetriesPerRequest เป็นค่าจำกัด ∵ null (ข้อกำหนด BullMQ blocking) จะทำให้
    // command ค้างยาวตอน Redis ล่ม — client นี้ยิง incrby/get/setex ควร fail เร็วกว่าค้าง.
    const client = new Redis({
      ...parseRedisUrl(config.get<string>('REDIS_URL')!),
      maxRetriesPerRequest: 3,
    });
    // ต้องมี 'error' listener มิฉะนั้น Redis ล่ม → unhandled 'error' ล้มทั้ง process
    // (เหตุผลเดียวกับ crawl.service.ts) + throttle กัน log ท่วมตอน ioredis retry ถี่.
    let lastErrorLogAt = 0;
    client.on('error', (err: Error) => {
      const now = Date.now();
      if (now - lastErrorLogAt < REDIS_ERROR_LOG_THROTTLE_MS) return;
      lastErrorLogAt = now;
      const code = (err as { code?: string }).code;
      const detail = [err.name, code, err.message].filter(Boolean).join(' ');
      logger.warn(
        `redis error: ${detail || 'unknown'} — REDIS_URL ใช้งานได้อยู่ไหม?`,
      );
    });
    return client;
  },
};

@Global()
@Module({
  providers: [redisProvider],
  exports: [REDIS],
})
export class RedisModule {}
