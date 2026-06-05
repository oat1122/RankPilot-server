import { z } from 'zod';

/**
 * Env schema — ขั้น setup เท่านั้น (เอกสาร 04 §5 / 05 §4).
 * DATABASE_URL / REDIS_URL ยัง optional ∵ ยังไม่เชื่อมต่อจริง (ยังไม่มีฟีเจอร์).
 * ใช้ Zod ตัวเดียวกับ DTO/LangGraph ตาม convention (เอกสาร 00 §1).
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  // ยังไม่ใช้งานในขั้น setup — ใส่ไว้รอ Phase 1
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
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
