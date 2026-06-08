import { Annotation } from '@langchain/langgraph';
import { z } from 'zod';

/**
 * PageAuditState + Zod schemas — เอกสาร 02 §1.
 * Phase 1 = diagnosis/draft/critique/priority. Phase 2 (fan-out) ⊕ intent/gaps
 * (intentMatch ∥ contentGap หลัง diagnose). fanout + awaitReview ยังเลื่อนไป Phase 3-4.
 */

export const DiagnosisSchema = z.object({
  primaryKeyword: z.string(),
  reasoning: z.string(),
  issues: z.array(
    z.object({
      type: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      note: z.string(),
    }),
  ),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export const MetaDraftSchema = z.object({
  title: z.string().max(60),
  metaDescription: z.string().max(155),
  rationale: z.string(),
});
export type MetaDraft = z.infer<typeof MetaDraftSchema>;

export const CritiqueSchema = z.object({
  pass: z.boolean(),
  problems: z.array(z.string()),
});
export type Critique = z.infer<typeof CritiqueSchema>;

/**
 * intentMatch (worker) — content ตรง search intent ของ primary keyword ไหม + ยืนยัน
 * cannibalization (เอกสาร 02 §0/§7). cannibalizationReal nullable (ไม่ใช่ optional) เพื่อให้
 * strict json_schema บังคับ key ครบ: true=ปัญหาจริง (intent เดียวกัน), false=ไม่ใช่ (intent ต่าง),
 * null=ไม่มีเพจพี่น้องให้ตัดสิน.
 */
export const IntentSchema = z.object({
  matches: z.boolean(),
  intent: z.string(),
  cannibalizationReal: z.boolean().nullable(),
  note: z.string(),
});
export type Intent = z.infer<typeof IntentSchema>;

/**
 * contentGap (worker) — subtopic ที่คู่แข่งใน SERP ครอบคลุมแต่หน้าเรายังขาด (เอกสาร 02 §0/§7).
 * competitors = โดเมนที่น่าจะครอบคลุม subtopic นั้น (ยังไม่ใช้ embeddings — Phase 6).
 */
export const ContentGapSchema = z.object({
  gaps: z.array(
    z.object({
      subtopic: z.string(),
      competitors: z.array(z.string()),
    }),
  ),
});
export type ContentGaps = z.infer<typeof ContentGapSchema>;

/** on-page + ranking + score ที่ loadContext ดึงจาก DB แล้วป้อนเข้า prompt (เอกสาร 02 §0). */
export interface PageContext {
  pageId: number;
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  headings: { h1: string[]; h2: string[]; h3: string[] } | null;
  paragraphs: string[] | null;
  wordCount: number;
  schemaTypes: string[] | null;
  primaryKeyword: string | null;
  primaryKeywordId: number | null; // ← Phase 2: ใช้ดึง SERP/หาเพจพี่น้อง + เขียน content_gaps/cannibalization
  position: number | null;
  pageTraffic: number;
  trafficPotential: number | null;
  keywordIntent: string | null;
  businessPotential: number; // 0-3 ระดับโปรเจค (Phase 1 default 1)
  keywordCoverage: number | null;
  healthScore: number | null;
  scoreBreakdown: unknown;
  // Phase 2 (fan-out): คู่แข่งใน SERP ของ primary keyword (ป้อน contentGap) — ตัดโดเมนเราออกแล้ว
  competitors: { domain: string; url: string; position: number }[];
  // Phase 2: เพจอื่นในโปรเจคที่ rank คีย์เดียวกัน (candidate cannibalization → intentMatch ตัดสิน)
  cannibalizationCandidates: {
    pageId: number;
    url: string;
    position: number | null;
  }[];
}

/** reducer รวมค่าสะสม (token / attempts) ข้ามโหนด + รอบ critique loop. */
const sumReducer = (a: number | undefined, b: number | undefined): number =>
  (a ?? 0) + (b ?? 0);

export const PageAuditState = Annotation.Root({
  pageId: Annotation<number>(),
  projectId: Annotation<number>(),
  runId: Annotation<number>(),
  crawlId: Annotation<number | undefined>(),
  context: Annotation<PageContext>(),
  diagnosis: Annotation<Diagnosis>(),
  // Phase 2 fan-out: intentMatch + contentGap เขียนคนละ channel → ขนานได้ไม่ชน
  intent: Annotation<Intent>(),
  gaps: Annotation<ContentGaps['gaps']>(),
  draft: Annotation<MetaDraft>(),
  critique: Annotation<Critique>(),
  draftAttempts: Annotation<number>({ reducer: sumReducer, default: () => 0 }),
  priority: Annotation<number>(),
  tokensIn: Annotation<number>({ reducer: sumReducer, default: () => 0 }),
  tokensOut: Annotation<number>({ reducer: sumReducer, default: () => 0 }),
});

export type PageAuditStateType = typeof PageAuditState.State;
