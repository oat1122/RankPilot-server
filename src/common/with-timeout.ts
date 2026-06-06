/**
 * race promise กับ timeout — reject ถ้าเกิน ms (เคลียร์ timer เสมอ กัน handle ค้าง).
 * ใช้ครอบ queue.add() ฝั่ง producer: ตอน Redis ล่ม ioredis offline-queue ไม่ reject เอง
 * (maxRetriesPerRequest:null) → request ค้างยาว; ครอบ timeout เพื่อตอบ 503 เร็ว ๆ.
 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`operation timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
