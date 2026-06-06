import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';

/**
 * Custom migration runner (เอกสาร 01 §3, §5).
 * รัน: `npm run db:migrate` (= tsx --env-file=.env src/db/migrate.ts) นอก Nest DI → อ่าน
 * DATABASE_URL จาก process.env ได้ (ข้อยกเว้น CLI).
 *
 * ขั้นตอน:
 *   1) drizzle migrate — apply migration ที่อยู่ใน journal (0000_*, …) ตามปกติ
 *   2) apply migrations/9999_vector_index.sql แบบ idempotent ∵ Drizzle generate ออก
 *      `VECTOR INDEX` ไม่ได้ (#3695) → เพิ่มเองด้วย raw SQL หลังตารางถูกสร้าง.
 *      ไฟล์ 9999 ไม่อยู่ใน _journal.json → drizzle ไม่แตะ เราจึง apply เองที่นี่.
 */
const MIGRATIONS_DIR = join(process.cwd(), 'src', 'db', 'migrations');
const VECTOR_INDEX_FILE = join(MIGRATIONS_DIR, '9999_vector_index.sql');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required to run migrations');

  const conn = await mysql.createConnection({
    uri: url,
    multipleStatements: true,
  });
  try {
    // 1) journal migrations
    const db = drizzle(conn);
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    console.log('✓ drizzle migrations applied');

    // 2) raw VECTOR INDEX — idempotent (เช็ค information_schema ก่อน)
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT 1 FROM information_schema.statistics
       WHERE table_schema = DATABASE()
         AND table_name = 'page_embeddings'
         AND index_name = 'vx_page_emb' LIMIT 1`,
    );
    if (rows.length === 0) {
      const sql = readFileSync(VECTOR_INDEX_FILE, 'utf8');
      await conn.query(sql);
      console.log('✓ VECTOR INDEX vx_page_emb created (9999_vector_index.sql)');
    } else {
      console.log('• VECTOR INDEX vx_page_emb already exists — skip');
    }
  } finally {
    await conn.end();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
