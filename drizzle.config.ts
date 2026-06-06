import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit config — เอกสาร 01 §5.
 * วางที่ repo root (ไม่อยู่ใน lint glob {src,apps,libs,test}) → ไม่ถูก type-check/lint.
 * paths อิง cwd (repo root): schema + migrations อยู่ใต้ src/db/ (Option B — mirror packages/db/src
 * เพื่อยก lift ออกเป็น packages/db ภายหลังได้เกือบ verbatim).
 *
 * `generate` ไม่ต่อ DB (แค่ diff schema → SQL) จึงไม่ต้องมี DATABASE_URL ตอน generate;
 * `dbCredentials.url` ใช้ตอน push/introspect เท่านั้น (migrate ใช้ custom runner src/db/migrate.ts).
 */
export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
