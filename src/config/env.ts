import { z } from 'zod';

/**
 * Env schema — fail-fast ตอน boot (เอกสาร 04 §5 / 05 §4).
 * ใช้ Zod ตัวเดียวกับ DTO/LangGraph ตาม convention (เอกสาร 00 §1).
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  // DATABASE_URL required แล้ว ∵ wire data layer (Drizzle + MariaDB 11.8 — เอกสาร 01 §5).
  // ต้องเป็น mysql:// (MariaDB ผ่าน driver mysql2) — สไตล์เดียวกับ REDIS_URL refine เพื่อ
  // fail-fast พร้อมข้อความชัดเจนที่ boot แทนที่จะ throw แบบ cryptic ตอน mysql2 createPool.
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required (Drizzle/MariaDB)')
    .refine((u) => /^mysql:\/\//i.test(u), {
      message:
        'DATABASE_URL ต้องขึ้นต้นด้วย mysql:// (MariaDB ผ่าน driver mysql2)',
    }),
  // REDIS_URL required แล้ว ∵ wire BullMQ queue 'crawl' (เอกสาร 03 §1 / 04 §5).
  // ต้องเป็น redis:// หรือ rediss:// — ไม่งั้น parseRedisUrl (new URL) จะ throw ตอน
  // BullMQ init แบบ cryptic แทนที่จะ fail-fast พร้อมข้อความชัดเจนที่ boot.
  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL is required (BullMQ)')
    .refine((u) => /^rediss?:\/\//i.test(u), {
      message: 'REDIS_URL ต้องขึ้นต้นด้วย redis:// หรือ rediss://',
    }),
  // เพดานเวลารอ queue.add() ฝั่ง api (producer) — กัน POST /crawls ค้างยาวเมื่อ Redis
  // ล่ม/ช้า (ioredis offline-queue + maxRetriesPerRequest:null ไม่ timeout เอง) แล้ว
  // ตอบ 503 เร็ว ๆ แทนปล่อยค้างจน client abort (เอกสาร 03 §1 / 00 §4).
  QUEUE_ENQUEUE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  // Crawler bot tunables (worker — เอกสาร 00 §0 [1] / 01 page_snapshots)
  CRAWLER_USER_AGENT: z
    .string()
    .default('RankPilotBot/0.1 (+https://rankpilot.app/bot)'),
  CRAWLER_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  CRAWLER_MAX_BYTES: z.coerce.number().int().positive().default(5_000_000),
  CRAWLER_MAX_REDIRECTS: z.coerce.number().int().nonnegative().default(5),

  // Ahrefs API v3 (เอกสาร 03 + 03a) — ดึง keyword ของ URL ผ่าน Site/Keywords Explorer,
  // ยิงจาก worker queue 'ahrefs' (api ≠ worker). ยัง "ไม่ wire" (setup phase) → key เป็น
  // optional: ไม่ใส่ก็ boot ได้ (AhrefsService จะ throw ตอนเรียกจริงในเฟสถัดไป) เหมือนที่
  // DATABASE_URL/REDIS_URL เคย optional ก่อน wire.
  AHREFS_API_KEY: z.string().min(1).optional(),
  // base v3 — Authorization: Bearer <key>; endpoint relative เช่น 'site-explorer/organic-keywords'.
  AHREFS_API_BASE_URL: z.string().url().default('https://api.ahrefs.com/v3'),
  // เพดาน units/เดือนระดับ workspace (plan-agnostic, เอกสาร 03) — default = โควต้าจริงของแผน
  // Lite ที่ยืนยันผ่าน limits-and-usage (units_limit_workspace=100000, per-key=ไม่จำกัด,
  // 2026-06-07). ระดับโปรเจคจัดสรรย่อยจาก projects.monthly_unit_budget (คนละตัว).
  AHREFS_MONTHLY_UNIT_BUDGET: z.coerce.number().int().positive().default(100000),
  // country default ของ Site/Keywords Explorer (ISO-3166 alpha-2) — เอกสาร 01 projects.country.
  AHREFS_DEFAULT_COUNTRY: z.string().length(2).default('th'),
});

export type Env = z.infer<typeof envSchema>;

/** ใช้กับ ConfigModule.forRoot({ validate }) — fail fast ถ้า env ผิด. */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${details}`);
  }
  return parsed.data;
}
