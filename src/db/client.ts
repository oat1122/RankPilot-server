import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

/**
 * Drizzle client (mysql2 pool) — เอกสาร 01 §5.
 *
 * อ่าน DATABASE_URL จาก process.env ตรง ๆ ∵ ไฟล์นี้เป็น data-layer client ที่ใช้ร่วมกับ
 * drizzle-kit/CLI + standalone scripts (migrate.ts / vector-smoke.ts) ซึ่งรันนอก Nest DI —
 * เป็นข้อยกเว้นเดียวที่อนุญาตตาม pattern เอกสาร. เมื่อ api/worker inject db จริง (phase ถัดไป)
 * จะ wrap ด้วย Nest provider ที่อ่านผ่าน ConfigService (validated, fail-fast) อีกชั้น.
 *
 * mysql2 pool เชื่อมต่อแบบ lazy (ต่อจริงตอน query แรก) → import ได้โดยยังไม่ต้องมี DB ขึ้น.
 */
const pool = mysql.createPool(process.env.DATABASE_URL!);

export const db = drizzle(pool, { schema, mode: 'default' });
export { schema };
