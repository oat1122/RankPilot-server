import type { BaseMessage } from '@langchain/core/messages';
import { critique, diagnose, draft, gap, intent } from './prompts';
import type { Critique, Diagnosis, MetaDraft, PageContext } from './state';

/** builders สร้าง message ด้วย content แบบ string เสมอ → cast เพื่อ assert ข้อความ. */
const text = (m: BaseMessage): string => m.content as string;

const ctx: PageContext = {
  pageId: 1,
  url: 'https://example.com/running-shoes',
  title: 'Best Running Shoes',
  metaDescription: null,
  h1: 'Best Running Shoes',
  headings: { h1: ['Best Running Shoes'], h2: [], h3: [] },
  paragraphs: ['We review running shoes.'],
  wordCount: 800,
  schemaTypes: [],
  primaryKeyword: 'running shoes',
  primaryKeywordId: 11,
  position: 4,
  pageTraffic: 100,
  trafficPotential: 9000,
  keywordIntent: 'commercial',
  businessPotential: 1,
  keywordCoverage: 80,
  healthScore: 70,
  scoreBreakdown: null,
  competitors: [
    { domain: 'nike.com', url: 'https://nike.com/running', position: 1 },
  ],
  cannibalizationCandidates: [
    { pageId: 2, url: 'https://example.com/shoes', position: 6 },
  ],
};

const diag: Diagnosis = {
  primaryKeyword: 'running shoes',
  reasoning: 'ok',
  issues: [],
};
const meta: MetaDraft = { title: 'T', metaDescription: 'M', rationale: 'why' };

describe('prompts', () => {
  it('diagnose: system = rules, human = JSON ของ context', () => {
    const msgs = diagnose(ctx);
    expect(msgs).toHaveLength(2);
    expect(text(msgs[0])).toContain('primaryKeyword');
    expect(text(msgs[1])).toContain('running shoes');
  });

  it('ไม่มี skills prefix เมื่อไม่ได้ส่ง', () => {
    expect(text(diagnose(ctx)[0]).startsWith('## SKILLS')).toBe(false);
  });

  it('skills ถูกวางบนสุดของ system message เมื่อส่งมา', () => {
    const sysContent = text(diagnose(ctx, { skills: '## SKILLS\nfoo' })[0]);
    expect(sysContent.startsWith('## SKILLS')).toBe(true);
  });

  it('draft: ใส่ critiqueProblems ลง human payload', () => {
    const crit: Critique = { pass: false, problems: ['title ยาวเกิน'] };
    expect(text(draft(ctx, diag, crit)[1])).toContain('title ยาวเกิน');
  });

  it('critique: human payload มีทั้ง draft และ diagnosis', () => {
    const human = text(critique(meta, diag)[1]);
    expect(human).toContain('metaDescription');
    expect(human).toContain('running shoes');
  });

  it('draft: ส่ง intent/gaps เข้า human payload (fan-out Phase 2)', () => {
    const human = text(
      draft(ctx, diag, undefined, {
        intent: {
          matches: true,
          intent: 'commercial',
          cannibalizationReal: null,
          note: 'ok',
        },
        gaps: [{ subtopic: 'ตารางไซส์', competitors: ['nike.com'] }],
      })[1],
    );
    expect(human).toContain('ตารางไซส์');
    expect(human).toContain('commercial');
  });

  it('intent: system = rules, human payload มี cannibalizationCandidates', () => {
    const msgs = intent(ctx, diag);
    expect(msgs).toHaveLength(2);
    expect(text(msgs[0])).toContain('cannibalization');
    expect(text(msgs[1])).toContain('cannibalizationCandidates');
  });

  it('gap: human payload มี competitors ใน context', () => {
    expect(text(gap(ctx, diag)[1])).toContain('nike.com');
  });
});
