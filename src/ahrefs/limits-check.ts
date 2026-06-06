import axios from 'axios';

/**
 * Free smoke check (เอกสาร 03 §7 reconcile source) — ยิง limits-and-usage ของ Ahrefs
 * (ราคา 0 units) เพื่อยืนยัน AHREFS_API_KEY + base URL + auth header ใช้งานได้จริง
 * โดยไม่เปลือง units. รัน: `npm run ahrefs:limits` (= tsx --env-file=.env ...).
 *
 * อ่าน process.env ตรง ๆ ∵ เป็น CLI standalone นอก Nest DI (ข้อยกเว้นเดียวกับ migrate.ts).
 */
async function main() {
  const key = process.env.AHREFS_API_KEY;
  const base = process.env.AHREFS_API_BASE_URL ?? 'https://api.ahrefs.com/v3';
  if (!key) {
    console.error('✗ AHREFS_API_KEY is required (ใส่ใน .env)');
    process.exit(1);
  }

  const url = `${base.replace(/\/+$/, '')}/subscription-info/limits-and-usage`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    validateStatus: () => true,
  });

  console.log(`GET ${url}`);
  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(res.data, null, 2));
  if (res.status < 200 || res.status >= 300) {
    console.error('✗ limits-and-usage ตอบไม่สำเร็จ — ตรวจ key/quota');
    process.exit(1);
  }
  console.log('✓ Ahrefs key + wiring ใช้งานได้ (0 units)');
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
