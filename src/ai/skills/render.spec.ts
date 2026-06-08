import { appliesToNode, renderSkills } from './render';
import type { Skill } from './render';

const skill = (over: Partial<Skill> = {}): Skill => ({
  slug: 'thai-meta',
  name: 'Thai meta style',
  description: 'd',
  body: 'rule body',
  appliesTo: ['draftMeta'],
  priority: 0,
  ...over,
});

describe('appliesToNode', () => {
  it('node อยู่ใน appliesTo → true', () => {
    expect(appliesToNode(['diagnose', 'draftMeta'], 'draftMeta')).toBe(true);
  });
  it("'*' → ทุกโหนด true", () => {
    expect(appliesToNode(['*'], 'critiqueDraft')).toBe(true);
  });
  it('ไม่ match → false', () => {
    expect(appliesToNode(['diagnose'], 'draftMeta')).toBe(false);
  });
});

describe('renderSkills', () => {
  it('ว่าง → คืน "" (sys() จะข้าม)', () => {
    expect(renderSkills([])).toBe('');
  });

  it('มี header ## SKILLS + ### ชื่อ + body (trim)', () => {
    const out = renderSkills([skill({ name: 'A', body: '  - rule A  ' })]);
    expect(out.startsWith('## SKILLS')).toBe(true);
    expect(out).toContain('### A');
    expect(out).toContain('- rule A');
    expect(out).not.toContain('  - rule A  '); // trimmed
  });

  it('หลาย skill เรียงตามลำดับที่ส่งเข้ามา (priority desc จาก repo)', () => {
    const out = renderSkills([
      skill({ name: 'High', priority: 10 }),
      skill({ name: 'Low', priority: 1 }),
    ]);
    expect(out.indexOf('### High')).toBeLessThan(out.indexOf('### Low'));
  });
});
