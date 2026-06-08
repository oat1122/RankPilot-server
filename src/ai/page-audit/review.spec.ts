import { isApproved, normalizeResume, REVIEW_INTERRUPT_KIND } from './review';
import type { PageAuditStateType } from './state';

describe('normalizeResume (HITL resume value → decision)', () => {
  it('object { decision: "reject" } → reject', () => {
    expect(normalizeResume({ decision: 'reject' })).toBe('reject');
  });

  it('object { decision: "approve" } → approve', () => {
    expect(normalizeResume({ decision: 'approve' })).toBe('approve');
  });

  it('string "reject" → reject', () => {
    expect(normalizeResume('reject')).toBe('reject');
  });

  it('ค่าแปลก/ว่าง → approve (default ปลอดภัย ไม่ทำ draft หาย)', () => {
    expect(normalizeResume(undefined)).toBe('approve');
    expect(normalizeResume(null)).toBe('approve');
    expect(normalizeResume({})).toBe('approve');
    expect(normalizeResume({ decision: 'weird' })).toBe('approve');
  });
});

describe('isApproved (persist gate)', () => {
  it('reject → false (persist ข้าม)', () => {
    expect(isApproved({ reviewDecision: 'reject' })).toBe(false);
  });

  it('approve → true', () => {
    expect(isApproved({ reviewDecision: 'approve' })).toBe(true);
  });

  it('undefined (HITL ปิด/ไม่ผ่าน review) → true (พฤติกรรมเดิม)', () => {
    expect(isApproved({} as PageAuditStateType)).toBe(true);
  });
});

describe('REVIEW_INTERRUPT_KIND', () => {
  it('คงที่ = approve_drafts (dashboard ใช้แยกชนิด interrupt)', () => {
    expect(REVIEW_INTERRUPT_KIND).toBe('approve_drafts');
  });
});
