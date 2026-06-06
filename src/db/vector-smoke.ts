import mysql from 'mysql2/promise';

/**
 * VECTOR smoke test (เอกสาร 04 §4 / 01 §5) — รัน: `npm run db:vector:check`
 * (= tsx --env-file=.env src/db/vector-smoke.ts) นอก Nest DI → อ่าน DATABASE_URL จาก process.env.
 *
 * ตรวจ 3 อย่างบน MariaDB ที่ DATABASE_URL ชี้ไป:
 *   1) VERSION() ≥ 11.7 (VECTOR ต้อง ≥11.7)
 *   2) VEC_DISTANCE_COSINE(VEC_FromText('[1,0]'), VEC_FromText('[0,1]')) ≈ 1
 *   3) round-trip คอลัมน์ VECTOR: insert packed float32 LE (แบบเดียวกับ custom type) → select กลับ;
 *      ถ้า insert binary พลาด → fallback VEC_FromText('[...]') (ตามหมายเหตุเอกสาร 01 §1/§5).
 */
function packFloat32LE(values: number[]): Buffer {
  const buf = Buffer.allocUnsafe(values.length * 4);
  for (let i = 0; i < values.length; i++) buf.writeFloatLE(values[i], i * 4);
  return buf;
}

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
      await conn.execute('INSERT INTO _vec_smoke (id, v) VALUES (1, ?)', [
        packFloat32LE(original),
      ]);
      path = 'binary';
    } catch {
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
