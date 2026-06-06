import { currentPeriod, periodSnapshotDate } from './period';

describe('period (เอกสาร 03 §5 / 03a §3)', () => {
  // ใช้ Date ที่ inject เข้ามาเพื่อ deterministic (ไม่ผูกนาฬิกาเครื่อง/timezone)
  it('currentPeriod → YYYY-MM (UTC)', () => {
    expect(currentPeriod(new Date('2026-06-07T12:00:00Z'))).toBe('2026-06');
    expect(currentPeriod(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });

  it('currentPeriod ใช้ UTC — ปลายเดือน + timezone ไม่เลื่อนเดือน', () => {
    // 2026-06-30 23:30Z ยังเป็นเดือน 06 ใน UTC (กันเครื่อง local +7 เผลอข้ามเป็น 07)
    expect(currentPeriod(new Date('2026-06-30T23:30:00Z'))).toBe('2026-06');
  });

  it('periodSnapshotDate = period + "-01" (วันที่ 1 ของเดือน, pin cache key)', () => {
    expect(periodSnapshotDate(new Date('2026-06-07T12:00:00Z'))).toBe(
      '2026-06-01',
    );
    expect(periodSnapshotDate(new Date('2026-12-31T23:59:59Z'))).toBe(
      '2026-12-01',
    );
  });

  it('snapshot date นิ่งทั้งเดือน → ต่างวันในเดือนเดียวกันได้ค่าเดียวกัน (ไม่ bust cache)', () => {
    const a = periodSnapshotDate(new Date('2026-06-01T00:00:00Z'));
    const b = periodSnapshotDate(new Date('2026-06-28T18:00:00Z'));
    expect(a).toBe(b);
  });
});
