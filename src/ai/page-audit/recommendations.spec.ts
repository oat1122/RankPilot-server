import { toRecommendationRows } from './recommendations';
import type { PageAuditStateType } from './state';

describe('toRecommendationRows', () => {
  it('สร้าง 4 rows (diagnosis/title_draft/meta_draft/priority) ผูก pageId เดียวกัน', () => {
    const s = {
      pageId: 7,
      diagnosis: { primaryKeyword: 'kw', reasoning: 'r', issues: [] },
      draft: { title: 'T', metaDescription: 'M', rationale: 'why' },
      priority: 42,
    } as unknown as PageAuditStateType;

    const rows = toRecommendationRows(s);
    expect(rows.map((r) => r.type)).toEqual([
      'diagnosis',
      'title_draft',
      'meta_draft',
      'priority',
    ]);
    expect(rows.every((r) => r.pageId === 7)).toBe(true);
    expect(rows[1].output).toEqual({ title: 'T', rationale: 'why' });
    expect(rows[2].output).toEqual({ metaDescription: 'M', rationale: 'why' });
    expect(rows[3].output).toEqual({ priority: 42 });
  });

  it('ข้าม diagnosis/draft ที่ยังไม่มี — เหลืออย่างน้อย priority (default 0)', () => {
    const rows = toRecommendationRows({ pageId: 1 } as PageAuditStateType);
    expect(rows.map((r) => r.type)).toEqual(['priority']);
    expect(rows[0].output).toEqual({ priority: 0 });
  });

  it('Phase 2: intent + content_gap แทรกหลัง diagnosis ก่อน title/meta', () => {
    const s = {
      pageId: 3,
      diagnosis: { primaryKeyword: 'kw', reasoning: 'r', issues: [] },
      intent: {
        matches: true,
        intent: 'commercial',
        cannibalizationReal: null,
        note: 'n',
      },
      gaps: [{ subtopic: 'sizing', competitors: ['nike.com'] }],
      draft: { title: 'T', metaDescription: 'M', rationale: 'why' },
      priority: 5,
    } as unknown as PageAuditStateType;

    const rows = toRecommendationRows(s);
    expect(rows.map((r) => r.type)).toEqual([
      'diagnosis',
      'intent',
      'content_gap',
      'title_draft',
      'meta_draft',
      'priority',
    ]);
    expect(rows[2].output).toEqual({
      gaps: [{ subtopic: 'sizing', competitors: ['nike.com'] }],
    });
  });

  it('content_gap ถูกข้ามเมื่อ gaps ว่าง', () => {
    const s = {
      pageId: 4,
      intent: {
        matches: false,
        intent: 'informational',
        cannibalizationReal: false,
        note: 'n',
      },
      gaps: [],
      priority: 0,
    } as unknown as PageAuditStateType;
    expect(toRecommendationRows(s).map((r) => r.type)).toEqual([
      'intent',
      'priority',
    ]);
  });
});
