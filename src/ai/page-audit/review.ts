import type { PageAuditStateType, ReviewDecision } from './state';

/**
 * HITL review helpers (Phase 4, เอกสาร 02 §8) — pure → unit test ได้โดยไม่ผูก langgraph.
 * แยกตรรกะ approve/reject ออกจากโหนด awaitReview (graph.ts ฝั่ง langgraph ที่ jest import ไม่ได้)
 * และจาก persistRun (repo) ให้ตัดสินใจชุดเดียวกัน.
 */

/** kind ของ interrupt payload ที่ awaitReview ส่งให้ dashboard (resume ด้วย Command). */
export const REVIEW_INTERRUPT_KIND = 'approve_drafts' as const;

/**
 * normalize ค่าที่ resume กลับเข้ามา (Command({ resume })) → decision ที่ใช้ได้เสมอ.
 * รองรับทั้ง string ('approve'/'reject') และ object ({ decision }). ไม่ใช่ 'reject' = อนุมัติ
 * (default ปลอดภัยฝั่ง approve — ค่าแปลก ๆ ไม่ทำให้ draft หาย).
 */
export function normalizeResume(resume: unknown): ReviewDecision {
  const raw =
    typeof resume === 'string'
      ? resume
      : ((resume as { decision?: unknown } | null | undefined)?.decision ??
        undefined);
  return raw === 'reject' ? 'reject' : 'approve';
}

/**
 * persist ควรเขียน recs ไหม. reject เท่านั้นที่ข้าม; undefined (HITL ปิด/ไม่ผ่าน awaitReview)
 * = อนุมัติ → คงพฤติกรรมเดิมก่อน Phase 4.
 */
export function isApproved(
  s: Pick<PageAuditStateType, 'reviewDecision'>,
): boolean {
  return s.reviewDecision !== 'reject';
}
