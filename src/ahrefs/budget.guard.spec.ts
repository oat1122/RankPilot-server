import { BudgetGuard } from './budget.guard';
import { ErrorCode } from '../common/http';
import type { RedisClient } from '../redis/redis.module';

/** mock raw ioredis client — เฉพาะ command ที่ BudgetGuard ใช้ (reserve = eval Lua). */
function makeRedis() {
  return {
    eval: jest.fn().mockResolvedValue([0, 1]),
    incrby: jest.fn().mockResolvedValue(0),
    get: jest.fn().mockResolvedValue(null),
  };
}

function makeGuard(redis: ReturnType<typeof makeRedis>) {
  return new BudgetGuard(redis as unknown as RedisClient);
}

const KEY = 'ahrefs:units:1:2026-06';

describe('BudgetGuard (เอกสาร 03 §5)', () => {
  describe('reserve (atomic Lua)', () => {
    it('จองสำเร็จ (ok=1) → เรียก eval ด้วย key+estimate+cap+ttl ไม่ throw', async () => {
      const redis = makeRedis();
      redis.eval.mockResolvedValue([50, 1]);
      await makeGuard(redis).reserve(1, '2026-06', 50, 100);
      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        KEY,
        50,
        100,
        expect.any(Number),
      );
    });

    it('เกิน cap (ok=0) → throw AHREFS_BUDGET_EXCEEDED', async () => {
      const redis = makeRedis();
      redis.eval.mockResolvedValue([150, 0]); // after=150 > cap=100 → ไม่จอง
      await expect(
        makeGuard(redis).reserve(1, '2026-06', 50, 100),
      ).rejects.toMatchObject({ code: ErrorCode.AHREFS_BUDGET_EXCEEDED });
    });

    it('ไม่แตะ counter เมื่อเกิน cap (atomic — ไม่ต้องคืนงบเองอีก)', async () => {
      const redis = makeRedis();
      redis.eval.mockResolvedValue([150, 0]);
      await makeGuard(redis)
        .reserve(1, '2026-06', 50, 100)
        .catch(() => undefined);
      // counter mutation ทั้งหมดอยู่ใน Lua แล้ว — ไม่มี incrby/decrby แยกฝั่ง client
      expect(redis.incrby).not.toHaveBeenCalled();
    });
  });

  describe('settle', () => {
    it('ปรับส่วนต่างเมื่อ actual ≠ estimate', async () => {
      const redis = makeRedis();
      await makeGuard(redis).settle(1, '2026-06', 50, 70);
      expect(redis.incrby).toHaveBeenCalledWith(KEY, 20);
    });

    it('คืนงบทั้งก้อนเมื่อ request ล้ม (actual=0)', async () => {
      const redis = makeRedis();
      await makeGuard(redis).settle(1, '2026-06', 50, 0);
      expect(redis.incrby).toHaveBeenCalledWith(KEY, -50);
    });

    it('ไม่ทำอะไรเมื่อ actual === estimate', async () => {
      const redis = makeRedis();
      await makeGuard(redis).settle(1, '2026-06', 50, 50);
      expect(redis.incrby).not.toHaveBeenCalled();
    });
  });

  describe('spent', () => {
    it('คืน 0 เมื่อยังไม่มี counter', async () => {
      const redis = makeRedis();
      expect(await makeGuard(redis).spent(1, '2026-06')).toBe(0);
    });

    it('parse number จาก Redis', async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue('250');
      expect(await makeGuard(redis).spent(1, '2026-06')).toBe(250);
    });
  });
});
