import { Inject, Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '../../common/http';
import { REDIS } from '../../redis/redis.module';
import type { RedisClient } from '../../redis/redis.module';

/** TTL ของ counter เดือน — 40 วัน (ครอบเดือน + grace ก่อน reconcile, เอกสาร 03 §5). */
const RESERVE_TTL_SEC = 60 * 60 * 24 * 40;

/**
 * reserve แบบ atomic ใน Redis (check-and-incr ในคำสั่งเดียว) — กัน race ที่ reserve
 * พร้อมกันหลายตัวต่างผ่าน cap แล้วรวมกันเกิน (incrby+get+decrby แยกคำสั่งทำไม่ได้).
 * คืน { after, ok }: ok=0 = เกิน cap (ไม่แตะ counter เลย → ไม่ต้องคืนงบ), ok=1 = จองสำเร็จ.
 * ตั้ง TTL ให้เมื่อ counter ยังไม่มี TTL (key ใหม่ หรือเคยถูกปล่อยไม่มี expire).
 * KEYS[1]=counter key; ARGV[1]=estimate, ARGV[2]=cap, ARGV[3]=ttlSec.
 */
const RESERVE_LUA = `
local est = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local after = cur + est
if after > cap then
  return {after, 0}
end
redis.call('INCRBY', KEYS[1], est)
if redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
end
return {after, 1}
`;

/**
 * BudgetGuard (เอกสาร 03 §5) — กันงบ units เกินเพดานแบบ atomic บน Redis.
 *
 * reserve: จองก่อนยิง (incrby); เกิน cap → คืน (decrby) แล้ว throw AHREFS_BUDGET_EXCEEDED.
 * settle:  ปรับยอดหลังรู้ units จริงจาก header x-units-cost (อาจ ≠ ที่ประเมิน).
 * Redis เป็น hot counter; ground truth durable อยู่ที่ ahrefs_usage (AhrefsRepo.bumpUsage).
 */
@Injectable()
export class BudgetGuard {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  private key(projectId: number, period: string): string {
    return `ahrefs:units:${projectId}:${period}`;
  }

  /** จองงบ atomic (Lua check-and-incr); ถ้ายอดใหม่เกิน cap → ไม่แตะ counter แล้ว throw. */
  async reserve(
    projectId: number,
    period: string,
    estimate: number,
    cap: number,
  ): Promise<void> {
    const k = this.key(projectId, period);
    const [after, ok] = (await this.redis.eval(
      RESERVE_LUA,
      1,
      k,
      estimate,
      cap,
      RESERVE_TTL_SEC,
    )) as [number, number];
    if (!ok) {
      throw new AppException(
        ErrorCode.AHREFS_BUDGET_EXCEEDED,
        `Ahrefs budget exceeded for project ${projectId} (${after}/${cap} units, ${period})`,
      );
    }
  }

  /** ปรับส่วนต่าง estimate→actual หลังยิงเสร็จ (actual=0 = คืนงบทั้งก้อนเมื่อ request ล้ม). */
  async settle(
    projectId: number,
    period: string,
    estimate: number,
    actual: number,
  ): Promise<void> {
    const delta = actual - estimate;
    if (delta !== 0)
      await this.redis.incrby(this.key(projectId, period), delta);
  }

  /** ยอด units ที่จองไปแล้วของเดือน (ให้ endpoint /budget อ่าน). */
  async spent(projectId: number, period: string): Promise<number> {
    const v = await this.redis.get(this.key(projectId, period));
    return v ? Number(v) : 0;
  }
}
