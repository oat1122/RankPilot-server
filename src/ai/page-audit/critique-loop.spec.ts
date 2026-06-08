import { nextAfterCritique } from './critique-loop';
import type { PageAuditStateType } from './state';

/** state บางส่วนสำหรับทดสอบ edge guard (cast เฉพาะที่ boundary). */
function st(over: Partial<PageAuditStateType>): PageAuditStateType {
  return over as PageAuditStateType;
}

describe('nextAfterCritique (critique loop guard)', () => {
  it('pass=true → prioritize', () => {
    const s = st({ critique: { pass: true, problems: [] }, draftAttempts: 1 });
    expect(nextAfterCritique(s, 2)).toBe('prioritize');
  });

  it('pass=false & attempts < max → draftMeta (loop)', () => {
    const s = st({
      critique: { pass: false, problems: ['x'] },
      draftAttempts: 1,
    });
    expect(nextAfterCritique(s, 2)).toBe('draftMeta');
  });

  it('attempts >= max → prioritize (กัน infinite loop)', () => {
    const s = st({
      critique: { pass: false, problems: ['x'] },
      draftAttempts: 2,
    });
    expect(nextAfterCritique(s, 2)).toBe('prioritize');
  });

  it('ยังไม่มี critique → draftMeta', () => {
    expect(nextAfterCritique(st({ draftAttempts: 1 }), 2)).toBe('draftMeta');
  });
});
