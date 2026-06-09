import { z } from 'zod';
import { EMBEDDING_DIM } from '../db/types/vector';

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

  // Rate limiting (security baseline) — ThrottlerModule ฝั่ง api เท่านั้น (worker ไม่มี HTTP).
  // กัน abuse/DoS + brute-force ตอนต่อ auth. ttl เป็น ms (ThrottlerModule v6). default = 120 req/นาที
  // ต่อ IP ทั้งแอป; endpoint อ่อนไหว (POST /crawls) ตั้งเพดานเข้มกว่าด้วย @Throttle (hardcode ∵
  // decorator อ่าน ConfigService ไม่ได้ — constraint เดียวกับ Ahrefs limiter ด้านล่าง).
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),

  // Crawler bot tunables (worker — เอกสาร 00 §0 [1] / 01 page_snapshots)
  CRAWLER_USER_AGENT: z
    .string()
    .default('RankPilotBot/0.1 (+https://rankpilot.app/bot)'),
  CRAWLER_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  CRAWLER_MAX_BYTES: z.coerce.number().int().positive().default(5_000_000),
  CRAWLER_MAX_REDIRECTS: z.coerce.number().int().nonnegative().default(5),
  // Site crawl (multi-page BFS+sitemap): hard cap ของ maxPages ที่ผู้ใช้กรอก + เพดาน URL จาก sitemap.
  CRAWLER_SITE_MAX_PAGES: z.coerce.number().int().positive().default(200),
  CRAWLER_SITEMAP_MAX_URLS: z.coerce.number().int().positive().default(2000),

  // HTML snapshot storage — เก็บ raw HTML ของ crawl เป็น .html.gz บน local disk (เอกสาร 05 §0/§4).
  // เลือก disk แทน R2/S3: ไม่มี egress + ไม่ต้องพึ่ง external service/creds. optional + มี default →
  // worker เขียนได้เสมอ (best-effort, เขียนไม่ได้ = ข้าม html_storage_key=null). บน Railway worker
  // ชี้ไป mount volume ถาวร. api ไม่ได้ใช้ (เฉพาะ worker persist) แต่ schema ใช้ร่วม (validateEnv ตัวเดียว).
  HTML_STORAGE_DIR: z.string().min(1).default('storage/html'),

  // PSI (PageSpeed Insights v5 — CWV lcp/cls/inp ลง page_snapshots, เอกสาร 01 §2).
  // gated ด้วย PSI_ENABLED ∵ call ช้า 10-30s/หน้า → default ปิดไม่ให้หน่วง crawl ปกติ/dev/test.
  // key optional (PSI ยิงได้แม้ไม่มี key แต่ quota ต่ำกว่า). stringbool กันเคส 'false' ถูกตีเป็น true.
  PSI_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  PSI_API_KEY: z.string().min(1).optional(),
  PSI_BASE_URL: z
    .string()
    .url()
    .default('https://www.googleapis.com/pagespeedonline/v5/runPagespeed'),
  PSI_STRATEGY: z.enum(['mobile', 'desktop']).default('mobile'),
  PSI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

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
  AHREFS_MONTHLY_UNIT_BUDGET: z.coerce
    .number()
    .int()
    .positive()
    .default(100000),
  // country default ของ Site/Keywords Explorer (ISO-3166 alpha-2) — เอกสาร 01 projects.country.
  AHREFS_DEFAULT_COUNTRY: z.string().length(2).default('th'),
  // TTL (วินาที) ของ cache organic-keywords (เอกสาร 03 §3 — Site Explorer organic ~7-14 วัน).
  // หมายเหตุ: RateLimiter ของ queue 'ahrefs' (เอกสาร 03 §5) hardcode ใน @Processor
  //   (decorator อ่าน ConfigService ไม่ได้ — ตรงกับ limiter:{max:5,duration:1000} ในเอกสาร).
  AHREFS_ORGANIC_TTL_SEC: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60),
  // TTL cache keywords-explorer/overview (เอกสาร 03 §3 — metric เปลี่ยนช้า ~30 วัน).
  AHREFS_KEYWORDS_TTL_SEC: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 24 * 60 * 60),
  // TTL cache site-explorer/top-pages (เอกสาร 03 §3 — Site Explorer organic ~7-14 วัน).
  AHREFS_TOPPAGES_TTL_SEC: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60),

  // OpenRouter (เอกสาร 02 §9) — LLM provider เดียวของ stage [4] AI Advisor, ยิงจาก worker
  // queue 'ai' (api ≠ worker). key optional แบบเดียวกับ AHREFS_API_KEY: ไม่ใส่ก็ boot ได้
  // (mkModel จะโยน AI_NOT_CONFIGURED ตอนเรียกจริงในโหนด LLM). base url default ของ OpenRouter.
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  // attribution headers → โผล่ใน OpenRouter rankings (HTTP-Referer / X-Title — เอกสาร 02 §2).
  OPENROUTER_SITE_URL: z.string().url().default('https://app.rankpilot'),
  OPENROUTER_APP_TITLE: z.string().min(1).default('RankPilot'),
  // เพดานเวลาต่อ LLM call (ms) — กันโหนดค้างเมื่อ provider ช้า/ค้าง.
  OPENROUTER_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  // HITL (เอกสาร 02 Phase 4): true → graph interrupt ที่ awaitReview ก่อน persist (รอ user
  // อนุมัติใน dashboard แล้ว resume); false → prioritize→persist ตรง (dev/test ไม่ค้างรอ review).
  // stringbool กันเคส 'false' ถูกตีเป็น true. default เปิด HITL ตามดีไซน์ Phase 4.
  AI_HITL_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Voyage embeddings (เอกสาร 00 / 02 Phase 6) — voyage-3.5 (1024-dim) สำหรับ VECTOR cannibalization.
  // key optional แบบเดียวกับ OPENROUTER/AHREFS: ไม่ใส่ก็ boot ได้ + AI audit ยังรันได้ (ข้าม embedding,
  // similarity=null เหมือน Phase 2) — EmbeddingService gate ด้วย key. ยิงจาก worker (loadPageContext).
  VOYAGE_API_KEY: z.string().min(1).optional(),
  VOYAGE_BASE_URL: z.string().url().default('https://api.voyageai.com/v1'),
  VOYAGE_MODEL: z.string().min(1).default('voyage-3.5'),
  // VOYAGE_DIM ส่งเป็น output_dimension ให้ Voyage (voyage.client) — ต้องเท่ากับมิติคอลัมน์
  // page_embeddings.embedding (EMBEDDING_DIM) เป๊ะ ไม่งั้น vector ที่ได้ insert ไม่ลง (best-effort
  // จับเงียบ → embedding ล้มถาวร). fail-fast ที่ boot ตาม convention แทนพังเงียบตอน insert.
  VOYAGE_DIM: z.coerce
    .number()
    .int()
    .refine((v) => v === EMBEDDING_DIM, {
      message: `VOYAGE_DIM ต้องเท่ากับ ${EMBEDDING_DIM} (มิติคอลัมน์ page_embeddings.embedding) — เปลี่ยนค่าต้องทำ migration คอลัมน์ด้วย`,
    })
    .default(EMBEDDING_DIM),
  VOYAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  // LangSmith tracing (เอกสาร 02 §6 Phase 6) — LangChain อ่าน LANGCHAIN_* จาก process.env เอง
  // (auto-trace เมื่อ TRACING_V2=true + มี API key). ใส่ใน schema เพื่อ validate/document + present
  // ใน process.env. ทั้งหมด optional → ไม่ตั้งก็ boot ได้ (tracing ปิด). stringbool กันเคส 'false'.
  LANGCHAIN_TRACING_V2: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  LANGCHAIN_API_KEY: z.string().min(1).optional(),
  LANGCHAIN_PROJECT: z.string().min(1).default('rankpilot'),
  LANGCHAIN_ENDPOINT: z
    .string()
    .url()
    .default('https://api.smith.langchain.com'),

  // Clerk auth (เอกสาร 05 §4) — auth ข้ามโดเมนด้วย Bearer JWT (api ≠ cookie). secret key ใช้
  // verify session token ฝั่ง backend (@clerk/backend verifyToken → ดึง JWKS ของ instance).
  // optional แบบเดียวกับ API key อื่น: dev/test ไม่ตั้ง → ClerkAuthGuard เข้าโหมด dev-bypass
  // (inject dev user) แอป/jest ยังรันได้; prod บังคับมีผ่าน validateEnv (secure-by-default ตอน deploy).
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  // azp allowlist (comma-sep) — verifyToken ใช้ยืนยันว่า token ออกจาก frontend ที่อนุญาตเท่านั้น
  // (กัน token จากแอปอื่นใน Clerk instance เดียวกัน). ว่าง = ไม่ตรวจ azp.
  CLERK_AUTHORIZED_PARTIES: z.string().optional(),

  // UserManager (เอกสาร 05 §4) — ปิด self sign-up: admin คุม user ผ่าน /users. ADMIN_EMAILS =
  // allowlist (comma-sep) ของ email ที่ login แล้วได้ role admin อัตโนมัติ (bootstrap admin คนแรก
  // ตอน DB ยังว่าง + env เป็น authority เหนือ DB กัน lockout). ว่าง = ไม่มี auto-admin (ต้อง seed เอง).
  // *ต้องตั้ง Clerk JWT template ให้มี email claim* ถึง match ได้ (session token มาตรฐานไม่มี email).
  // เก็บเป็น string แล้ว parse ในชั้น ClerkAuthGuard — แพทเทิร์นเดียวกับ CLERK_AUTHORIZED_PARTIES.
  ADMIN_EMAILS: z.string().optional(),
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
  // ข้อบังคับข้ามฟิลด์: prod ต้องมี CLERK_SECRET_KEY (auth secure-by-default ตอน deploy —
  // เอกสาร 05 §4) — กันพลาด deploy แล้ว ClerkAuthGuard ตกไป dev-bypass เปิด endpoint public.
  // dev/test ไม่บังคับ (bypass เป็น dev user). เช็คตรงนี้แทน superRefine เพื่อคง envSchema เป็น
  // ZodObject (ฟีเจอร์ .shape ฯลฯ ใช้ได้) + ข้อความ error สไตล์เดียวกับด้านบน.
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.CLERK_SECRET_KEY) {
    throw new Error(
      'Invalid environment variables:\n  - CLERK_SECRET_KEY: required in production (auth secure-by-default — เอกสาร 05 §4)',
    );
  }
  return parsed.data;
}
