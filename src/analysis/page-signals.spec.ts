import {
  aggregatePageSignals,
  RANKING_RECENCY_WINDOW_MS,
} from './analysis.repo';
import type { RankingRow } from './analysis.repo';

const T = 1_700_000_000_000; // epoch ฐาน (คงที่ — ไม่ใช้ Date.now)
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function row(over: Partial<RankingRow> = {}): RankingRow {
  return {
    pageId: 1,
    keyword: 'k',
    position: 1,
    traffic: 0,
    capturedAt: T,
    ...over,
  };
}

describe('aggregatePageSignals (flow [2]→[3] ranking signal)', () => {
  it('ว่าง → map ว่าง', () => {
    expect(aggregatePageSignals([]).size).toBe(0);
  });

  it('primary = position น้อยสุด, pageTraffic = Σ traffic', () => {
    const out = aggregatePageSignals([
      row({ keyword: 'a', position: 5, traffic: 40 }),
      row({ keyword: 'b', position: 2, traffic: 60 }),
    ]);
    expect(out.get(1)).toEqual({
      primaryKeyword: 'b',
      position: 2,
      pageTraffic: 100,
    });
  });

  it('dedup เอา capture ล่าสุดต่อ (page|keyword) — ไม่นับ traffic ซ้ำ', () => {
    const out = aggregatePageSignals([
      row({ keyword: 'a', position: 9, traffic: 40, capturedAt: T }),
      row({ keyword: 'a', position: 3, traffic: 100, capturedAt: T + HOUR }),
    ]);
    expect(out.get(1)).toEqual({
      primaryKeyword: 'a',
      position: 3,
      pageTraffic: 100,
    });
  });

  it('ตัด keyword ที่หลุดอันดับรอบเก่า (เกิน recency window) → pageTraffic ไม่พอง', () => {
    const out = aggregatePageSignals([
      row({ keyword: 'a', position: 3, traffic: 100, capturedAt: T }), // สด
      row({ keyword: 'b', position: 5, traffic: 50, capturedAt: T - 30 * DAY }), // เก่า > 7 วัน
    ]);
    // b ถูกตัด (capture เกินหน้าต่างจาก max ของหน้า) → เหลือแค่ a
    expect(out.get(1)).toEqual({
      primaryKeyword: 'a',
      position: 3,
      pageTraffic: 100,
    });
  });

  it('หลายรอบ enrich ในหน้าต่างเดียวกัน (domain + exact) สะสม coverage รวมกัน', () => {
    const out = aggregatePageSignals([
      row({ keyword: 'a', position: 3, traffic: 100, capturedAt: T }), // domain
      row({ keyword: 'c', position: 7, traffic: 80, capturedAt: T + 2 * HOUR }), // exact
      row({
        keyword: 'd',
        position: null,
        traffic: 30,
        capturedAt: T + 2 * HOUR,
      }),
    ]);
    // ทุกแถวอยู่ในหน้าต่าง → primary = a (pos 3 น้อยสุด, d ไม่มี position ไม่นับ primary)
    expect(out.get(1)).toEqual({
      primaryKeyword: 'a',
      position: 3,
      pageTraffic: 210,
    });
  });

  it('หน้าต่าง recency แยกอิสระต่อหน้า', () => {
    const out = aggregatePageSignals([
      // page 1: max = T → ตัดแถว T-30d
      row({ pageId: 1, keyword: 'a', position: 2, traffic: 10, capturedAt: T }),
      row({
        pageId: 1,
        keyword: 'old',
        position: 1,
        traffic: 999,
        capturedAt: T - 30 * DAY,
      }),
      // page 2: max = T-30d → แถวเดียวยังอยู่ในหน้าต่างของตัวเอง
      row({
        pageId: 2,
        keyword: 'z',
        position: 4,
        traffic: 70,
        capturedAt: T - 30 * DAY,
      }),
    ]);
    expect(out.get(1)).toEqual({
      primaryKeyword: 'a',
      position: 2,
      pageTraffic: 10,
    });
    expect(out.get(2)).toEqual({
      primaryKeyword: 'z',
      position: 4,
      pageTraffic: 70,
    });
  });

  it('ขอบหน้าต่าง: พอดี window = เก็บ, เกิน 1ms = ตัด', () => {
    const keep = aggregatePageSignals([
      row({ keyword: 'a', traffic: 10, position: 1, capturedAt: T }),
      row({
        keyword: 'edge',
        traffic: 5,
        position: 2,
        capturedAt: T - RANKING_RECENCY_WINDOW_MS,
      }),
    ]);
    expect(keep.get(1)!.pageTraffic).toBe(15); // edge อยู่พอดีขอบ → เก็บ

    const drop = aggregatePageSignals([
      row({ keyword: 'a', traffic: 10, position: 1, capturedAt: T }),
      row({
        keyword: 'edge',
        traffic: 5,
        position: 2,
        capturedAt: T - RANKING_RECENCY_WINDOW_MS - 1,
      }),
    ]);
    expect(drop.get(1)!.pageTraffic).toBe(10); // เกินขอบ 1ms → ตัด
  });
});
