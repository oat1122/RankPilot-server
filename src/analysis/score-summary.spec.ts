import { summarizeScores } from './score-summary';

describe('summarizeScores (gap #4 aggregate)', () => {
  it('avg เฉพาะค่าที่ไม่ใช่ null, ปัดจำนวนเต็ม, pagesScored = จำนวน row', () => {
    const out = summarizeScores([
      { healthScore: 71, keywordCoverage: 100 },
      { healthScore: 78, keywordCoverage: 70 },
      { healthScore: 85, keywordCoverage: 80 },
    ]);
    expect(out).toEqual({
      avgHealthScore: 78, // (71+78+85)/3 = 78
      avgKeywordCoverage: 83, // (100+70+80)/3 = 83.33 → 83
      pagesScored: 3,
    });
  });

  it('ข้าม null ตอนหา avg แต่ยังนับใน pagesScored', () => {
    const out = summarizeScores([
      { healthScore: 80, keywordCoverage: null },
      { healthScore: null, keywordCoverage: 60 },
    ]);
    expect(out).toEqual({
      avgHealthScore: 80,
      avgKeywordCoverage: 60,
      pagesScored: 2,
    });
  });

  it('ไม่มีคะแนนเลย → avg = null, pagesScored = 0', () => {
    expect(summarizeScores([])).toEqual({
      avgHealthScore: null,
      avgKeywordCoverage: null,
      pagesScored: 0,
    });
  });

  it('ทุกค่าเป็น null → avg = null แต่ pagesScored นับ row', () => {
    expect(
      summarizeScores([{ healthScore: null, keywordCoverage: null }]),
    ).toEqual({
      avgHealthScore: null,
      avgKeywordCoverage: null,
      pagesScored: 1,
    });
  });
});
