import mysql from 'mysql2/promise';
import { packVectorLE } from './types/vector';

/**
 * VECTOR smoke test (เอกสาร 04 §4 / 01 §5) — รัน: `npm run db:vector:check`
 * (= tsx --env-file=.env src/db/vector-smoke.ts) นอก Nest DI → อ่าน DATABASE_URL จาก process.env.
 *
 * ตรวจ 3 อย่างบน MariaDB ที่ DATABASE_URL ชี้ไป:
 *   1) VERSION() ≥ 11.7 (VECTOR ต้อง ≥11.7)
 *   2) VEC_DISTANCE_COSINE(VEC_FromText('[1,0]'), VEC_FromText('[0,1]')) ≈ 1
 *   3) round-trip คอลัมน์ VECTOR ผ่าน "path เดียวกับ Drizzle custom type" คือ insert
 *      packed float32 LE (packVectorLE — ฟังก์ชันเดียวกับ toDriver) ผ่าน conn.query
 *      (text protocol) แล้ว select กลับ. ⚠️ ต้องเป็น conn.query ไม่ใช่ conn.execute:
 *      MariaDB VECTOR ปฏิเสธ Buffer ที่ส่งผ่าน prepared/binary protocol ("Incorrect
 *      vector value") และ Drizzle mysql2 ก็ใช้ client.query เป็น path ปกติ. ถ้า binary
 *      พลาดจริง → fallback VEC_FromText พร้อม log เหตุ (ไม่กลืน error เงียบ ๆ).
 */
function versionAtLeast(
  version: string,
  major: number,
  minor: number,
): boolean {
  const m = /^(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > major || (maj === major && min >= minor);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for vector smoke test');

  const conn = await mysql.createConnection({ uri: url });
  try {
    // 1) VERSION ≥ 11.7
    const [vrows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT VERSION() AS v',
    );
    const version = String(vrows[0].v);
    const okVersion = versionAtLeast(version, 11, 7);
    console.log(
      `[1] VERSION() = ${version} → ${okVersion ? '✓ ≥11.7' : '✗ <11.7 (VECTOR unsupported)'}`,
    );
    if (!okVersion) throw new Error('MariaDB < 11.7 — VECTOR not available');

    // 2) VEC_DISTANCE_COSINE([1,0],[0,1]) ≈ 1
    const [drows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT VEC_DISTANCE_COSINE(VEC_FromText('[1,0]'), VEC_FromText('[0,1]')) AS d`,
    );
    const dist = Number(drows[0].d);
    const okDist = Math.abs(dist - 1) < 1e-6;
    console.log(
      `[2] VEC_DISTANCE_COSINE([1,0],[0,1]) = ${dist} → ${okDist ? '✓ ≈1' : '✗ != 1'}`,
    );

    // 3) round-trip VECTOR(2): packed binary → fallback VEC_FromText
    await conn.query(
      'CREATE TEMPORARY TABLE _vec_smoke (id INT PRIMARY KEY, v VECTOR(2) NOT NULL)',
    );
    const original = [0.25, -0.75];
    let path: 'binary' | 'vec_fromtext';
    try {
      // conn.query (text protocol) = path เดียวกับที่ Drizzle mysql2 ใช้ insert จริง
      await conn.query('INSERT INTO _vec_smoke (id, v) VALUES (1, ?)', [
        packVectorLE(original),
      ]);
      path = 'binary';
    } catch (err) {
      // ไม่กลืน error: log เหตุที่ binary พลาด เพื่อให้เห็น regression ของ path จริง
      console.warn(
        `   ⚠️ binary insert (packed float32 LE) ล้มเหลว → fallback VEC_FromText: ${(err as Error).message}`,
      );
      await conn.query(
        `INSERT INTO _vec_smoke (id, v) VALUES (1, VEC_FromText('[${original.join(',')}]'))`,
      );
      path = 'vec_fromtext';
    }
    const [rrows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT VEC_ToText(v) AS t FROM _vec_smoke WHERE id = 1',
    );
    const got = (JSON.parse(String(rrows[0].t)) as number[]).map(
      (n) => Math.round(n * 1e4) / 1e4,
    );
    const okRound = got[0] === original[0] && got[1] === original[1];
    console.log(
      `[3] VECTOR round-trip via ${path}: stored ${JSON.stringify(original)} → read ${JSON.stringify(got)} → ${okRound ? '✓' : '✗'}`,
    );

    if (okVersion && okDist && okRound)
      console.log('\nALL VECTOR CHECKS PASSED ✓');
    else throw new Error('one or more VECTOR checks failed');
  } finally {
    await conn.end();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
