import { Global, Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/mysql2';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

/**
 * Nest provider ครอบ Drizzle client — เฟสที่ db/client.ts §8-11 เกริ่นไว้ ("phase ถัดไป
 * จะ wrap ด้วย Nest provider ที่อ่านผ่าน ConfigService"). Ahrefs Enrichment (เอกสาร 03)
 * เป็น flow แรกที่เขียน DB จริง (crawler แค่คืน job.returnvalue) จึงต้อง inject db ได้.
 *
 * อ่าน DATABASE_URL ผ่าน ConfigService (validated, fail-fast) ไม่ใช่ process.env ตรง
 * (เอกสาร 00 §1). pool คนละตัวกับ singleton ใน client.ts ซึ่งสงวนไว้ให้ CLI/migrate เท่านั้น.
 */
export const DB = Symbol('DB');

/** type ของ db ที่ inject — ผูก schema เพื่อให้ query มี type ครบ. */
export type Db = MySql2Database<typeof schema>;

const dbProvider: Provider = {
  provide: DB,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Db => {
    const url = config.get<string>('DATABASE_URL')!;
    // lazy pool — ต่อจริงตอน query แรก (import ได้โดยยังไม่ต้องมี DB ขึ้น)
    const pool = mysql.createPool(url);
    return drizzle(pool, { schema, mode: 'default' });
  },
};

@Global()
@Module({
  providers: [dbProvider],
  exports: [DB],
})
export class DbModule {}
