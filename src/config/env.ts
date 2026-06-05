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
  // DATABASE_URL ยัง optional ∵ ยังไม่เชื่อม DB (Phase 1 — เอกสาร 01)
  DATABASE_URL: z.string().optional(),
  // REDIS_URL required แล้ว ∵ wire BullMQ queue 'crawl' (เอกสาร 03 §1 / 04 §5)
  REDIS_URL: z.string().min(1, 'REDIS_URL is required (BullMQ)'),

  // Crawler bot tunables (worker — เอกสาร 00 §0 [1] / 01 page_snapshots)
  CRAWLER_USER_AGENT: z
    .string()
    .default('RankPilotBot/0.1 (+https://rankpilot.app/bot)'),
  CRAWLER_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  CRAWLER_MAX_BYTES: z.coerce.number().int().positive().default(5_000_000),
  CRAWLER_MAX_REDIRECTS: z.coerce.number().int().nonnegative().default(5),
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
