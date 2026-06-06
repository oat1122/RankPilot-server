/**
 * Period 'YYYY-MM' ของงบ units รายเดือน (เอกสาร 03 §5 — key Redis + ahrefs_usage.period).
 * ใช้ UTC ให้ deterministic (ไม่ผูก timezone ของเครื่อง) + รับ Date เข้ามาได้เพื่อทดสอบ.
 */
export function currentPeriod(d: Date = new Date()): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
