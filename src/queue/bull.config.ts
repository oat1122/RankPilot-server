import { ConfigService } from '@nestjs/config';

/**
 * แปลง REDIS_URL → ioredis options (plain object).
 * เหตุที่ไม่ส่ง instance ของ `new Redis()`: bullmq bundle ioredis คนละชุดกับโปรเจค
 * → ส่ง class instance แล้ว type ชนกัน. plain options เข้ากันได้กับทั้งสองชุด.
 */
export function parseRedisUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null, // ข้อกำหนดของ BullMQ worker (blocking commands)
  };
}

/**
 * Shared BullMQ root config — ใช้ร่วมทั้ง api (producer) และ worker (consumer)
 * เพื่อไม่ให้ connection factory ซ้ำสองที่ (เอกสาร 03 §1 / 04 §5).
 * อ่าน REDIS_URL ผ่าน ConfigService (validated, fail-fast) — ไม่อ่าน process.env ตรง.
 */
export const bullRootAsyncOptions = {
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    connection: parseRedisUrl(config.get<string>('REDIS_URL')!),
  }),
};
