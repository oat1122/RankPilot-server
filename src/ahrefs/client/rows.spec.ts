import { extractRowArray } from './rows';

describe('extractRowArray (shared client ↔ enrichment)', () => {
  it('array ตรง ๆ → คืนเฉพาะ element ที่เป็น object', () => {
    expect(extractRowArray([{ a: 1 }, null, 'x', { b: 2 }])).toEqual([
      { a: 1 },
      { b: 2 },
    ]);
  });

  it('object ที่ห่อ array (รูป v3 {keywords:[...]}) → หยิบ array แรก', () => {
    const data = { keywords: [{ keyword: 'seo' }, { keyword: 'sem' }] };
    expect(extractRowArray(data)).toHaveLength(2);
  });

  it('ข้าม property ที่ไม่ใช่ array แล้วหยิบ array แรกที่เจอ', () => {
    const data = { meta: { total: 2 }, keywords: [{ keyword: 'seo' }] };
    expect(extractRowArray(data)).toEqual([{ keyword: 'seo' }]);
  });

  it('null / primitive / object ไม่มี array → []', () => {
    expect(extractRowArray(null)).toEqual([]);
    expect(extractRowArray(42)).toEqual([]);
    expect(extractRowArray({ total: 0 })).toEqual([]);
  });
});
