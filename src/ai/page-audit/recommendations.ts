import type { PageAuditStateType } from './state';

/**
 * map final state → rows ของ ai_recommendations (schema ai_recommendations / เอกสาร 02 §0).
 * pure → unit test ได้. Phase 1 = diagnosis/title_draft/meta_draft/priority; Phase 2 ⊕
 * intent/content_gap (จาก fan-out). ทุกชนิดอยู่ใน enum aiRecommendations.type แล้ว.
 * status default 'suggested' (เป็นข้อเสนอจนกว่า user apply — เอกสาร 02 §8).
 */

export type RecommendationType =
  | 'diagnosis'
  | 'intent'
  | 'content_gap'
  | 'title_draft'
  | 'meta_draft'
  | 'priority';

export interface NewRecommendation {
  pageId: number;
  type: RecommendationType;
  output: unknown; // เก็บลง json column ai_recommendations.output
}

export function toRecommendationRows(
  s: PageAuditStateType,
): NewRecommendation[] {
  const rows: NewRecommendation[] = [];

  if (s.diagnosis)
    rows.push({ pageId: s.pageId, type: 'diagnosis', output: s.diagnosis });

  // Phase 2 (fan-out): intent + content_gap — ตารางเสริม (content_gaps/cannibalization_*)
  // เขียนใน AiRepo.persistRun; ที่นี่เก็บเป็น rec ให้ Dashboard อ่านผ่าน GET /ai/recommendations.
  if (s.intent)
    rows.push({ pageId: s.pageId, type: 'intent', output: s.intent });

  if (s.gaps?.length)
    rows.push({
      pageId: s.pageId,
      type: 'content_gap',
      output: { gaps: s.gaps },
    });

  if (s.draft) {
    rows.push({
      pageId: s.pageId,
      type: 'title_draft',
      output: { title: s.draft.title, rationale: s.draft.rationale },
    });
    rows.push({
      pageId: s.pageId,
      type: 'meta_draft',
      output: {
        metaDescription: s.draft.metaDescription,
        rationale: s.draft.rationale,
      },
    });
  }

  rows.push({
    pageId: s.pageId,
    type: 'priority',
    output: { priority: s.priority ?? 0 },
  });

  return rows;
}
