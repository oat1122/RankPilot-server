import type { PageAuditStateType } from './state';

/** จำนวนรอบ draftMeta⇄critique สูงสุด (กัน infinite + คุม token — เอกสาร 02 §8). */
export const MAX_DRAFT = 2;

/**
 * conditional edge หลัง critique (pure → unit test ได้ โดยไม่ผูก langgraph). loop กลับ
 * draftMeta ถ้ายังไม่ผ่านและยังไม่ครบ maxDraft, ไม่งั้นออกจาก loop ไป queryFanout (Phase 3:
 * แทรกก่อน prioritize — draft จบแล้วค่อยเดา sub-question ของ AI search).
 */
export function nextAfterCritique(
  s: PageAuditStateType,
  maxDraft: number = MAX_DRAFT,
): 'draftMeta' | 'queryFanout' {
  const pass = s.critique?.pass === true;
  const attempts = s.draftAttempts ?? 0;
  return pass || attempts >= maxDraft ? 'queryFanout' : 'draftMeta';
}
