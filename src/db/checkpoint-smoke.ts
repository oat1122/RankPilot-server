import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import type { PendingWrite } from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import { MariaDbSaver } from '../ai/checkpoint/mariadb-saver';
import type { Db } from './db.module';
import * as schema from './schema';
import { aiCheckpointWrites } from './schema';

/**
 * Checkpoint writes smoke test — รัน: `npm run db:checkpoint:check`
 * (= tsx --env-file=.env src/db/checkpoint-smoke.ts) นอก Nest DI → อ่าน DATABASE_URL จาก process.env.
 *
 * ทำไมต้อง tsx ไม่ใช่ jest: MariaDbSaver ผูก langgraph (ESM) — jest parse ไม่ได้
 * (ai.tokens.ts §, mariadb-saver.ts header) → convention คือ verify saver ด้วย runtime จริง.
 *
 * regression guard ของบั๊ก ER_PARSE_ERROR near 'blob)' (errno 1064): คอลัมน์ `blob` เป็น
 * reserved word ของ MariaDB → ON DUPLICATE KEY UPDATE ที่อ้าง `values(blob)` แบบไม่มี backtick
 * พังตอน parse. ตรวจ path เดียวกับที่ langgraph เรียกจริง: putWrites (INSERT … ON DUPLICATE
 * KEY UPDATE) ทั้ง insert ใหม่ + เรียกซ้ำ (update) แล้วอ่านกลับ จากนั้น deleteThread cleanup.
 */
const THREAD_ID = 'smoke:checkpoint:thread';
const CHECKPOINT_NS = '';
const CHECKPOINT_ID = '1f000000-0000-6000-ffff-000000000000';
const TASK_ID = '00000000-0000-5000-8000-000000000000';

function configFor(): RunnableConfig {
  return {
    configurable: {
      thread_id: THREAD_ID,
      checkpoint_ns: CHECKPOINT_NS,
      checkpoint_id: CHECKPOINT_ID,
    },
  };
}

async function countWrites(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(aiCheckpointWrites)
    .where(
      and(
        eq(aiCheckpointWrites.threadId, THREAD_ID),
        eq(aiCheckpointWrites.checkpointNs, CHECKPOINT_NS),
        eq(aiCheckpointWrites.checkpointId, CHECKPOINT_ID),
      ),
    );
  return rows.length;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error('DATABASE_URL is required for checkpoint smoke test');

  const pool = mysql.createPool(url);
  const db: Db = drizzle(pool, { schema, mode: 'default' });
  const saver = new MariaDbSaver(db);
  let ok1 = false;
  let ok2 = false;
  let ok3 = false;

  try {
    // เคลียร์ของค้างจากรอบก่อน (ถ้ามี) เพื่อให้ deterministic
    await saver.deleteThread(THREAD_ID);

    // payload มิเรอร์เคสจริงที่พัง: รวม special channel (branch:to:*) + ค่า null
    const writes: PendingWrite[] = [
      ['pageId', 7],
      ['projectId', 2],
      ['runId', 13],
      ['crawlId', 4],
      ['branch:to:loadContext', null],
    ];

    // [1] insert ครั้งแรก — บรรทัดที่เคยพัง ER_PARSE_ERROR near 'blob)'
    await saver.putWrites(configFor(), writes, TASK_ID);
    const n1 = await countWrites(db);
    ok1 = n1 === writes.length;
    console.log(
      `[1] putWrites insert: ${n1}/${writes.length} rows → ${ok1 ? '✓' : '✗'}`,
    );

    // [2] เรียกซ้ำด้วย blob ใหม่ — เดิน path ON DUPLICATE KEY UPDATE `blob`=values(`blob`)
    const writes2: PendingWrite[] = [
      ['pageId', 7],
      ['projectId', 2],
      ['runId', 99], // เปลี่ยนค่า → ต้องเขียนทับ blob ได้
      ['crawlId', 4],
      ['branch:to:loadContext', null],
    ];
    await saver.putWrites(configFor(), writes2, TASK_ID);
    const n2 = await countWrites(db);
    ok2 = n2 === writes2.length; // upsert ไม่เพิ่มแถว (PK เดิม)
    console.log(
      `[2] putWrites upsert (ON DUPLICATE KEY UPDATE blob): still ${n2} rows → ${ok2 ? '✓' : '✗'}`,
    );

    // [3] cleanup — deleteThread ต้องลบหมด
    await saver.deleteThread(THREAD_ID);
    const n3 = await countWrites(db);
    ok3 = n3 === 0;
    console.log(
      `[3] deleteThread cleanup: ${n3} rows left → ${ok3 ? '✓' : '✗'}`,
    );

    if (ok1 && ok2 && ok3) console.log('\nALL CHECKPOINT CHECKS PASSED ✓');
    else throw new Error('one or more checkpoint checks failed');
  } finally {
    await pool.end();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
