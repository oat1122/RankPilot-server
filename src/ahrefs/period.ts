/**
 * Period 'YYYY-MM' ของงบ units รายเดือน (เอกสาร 03 §5 — key Redis + ahrefs_usage.period).
 * ใช้ UTC ให้ deterministic (ไม่ผูก timezone ของเครื่อง) + รับ Date เข้ามาได้เพื่อทดสอบ.
 */
export function currentPeriod(d: Date = new Date()): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * วันที่ snapshot 'YYYY-MM-01' สำหรับ param `date` ของ Site/Keywords Explorer (เอกสาร 03a §3
 * — date เป็น required). pin กับ period (วันที่ 1 ของเดือน) โดยตั้งใจ: ทำให้ cache key
 * (sha1 ของ params) "นิ่งทั้งเดือน" → enrich ซ้ำใน TTL เดียวกันได้ cache hit (0 units)
 * แทนที่จะ bust ทุกวันถ้าใช้วันที่จริง. ความถี่ refresh จริงคุมด้วย TTL (เอกสาร 03 §3/§6),
 * ไม่ใช่ความละเอียดของ date นี้ — metric ของ Ahrefs เปลี่ยนช้าอยู่แล้ว (เอกสาร 03 §3).
 */
export function periodSnapshotDate(d: Date = new Date()): string {
  return `${currentPeriod(d)}-01`;
}
