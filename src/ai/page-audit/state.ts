import { Annotation } from '@langchain/langgraph';
import { z } from 'zod';

/**
 * PageAuditState + Zod schemas — เอกสาร 02 §1.
 * Phase 1 = diagnosis/draft/critique/priority. Phase 2 (fan-out) ⊕ intent/gaps
 * (intentMatch ∥ contentGap หลัง diagnose). Phase 3 ⊕ fanout (queryFanout หลัง critique
 * loop). Phase 4 (HITL) ⊕ reviewDecision (ผลอนุมัติจาก awaitReview interrupt → resume).
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

/**
 * queryFanout (worker, Phase 3) — เดา sub-question ที่ผู้ใช้ AI search (ChatGPT/Perplexity)
 * จะถามกับหัวข้อนี้ → ใช้เพิ่ม section/FAQ ให้ถูก cite + แนะ structured-data schema ที่ควรใส่
 * (เอกสาร 02 §0/§1/§7). suggestedSchema จำกัด enum เพื่อ map ตรงกับ JSON-LD @type ที่รองรับ.
 */
export const FanoutSchema = z.object({
  subQuestions: z.array(z.string()),
  suggestedSchema: z.array(z.enum(['FAQPage', 'HowTo', 'Article'])),
});
export type Fanout = z.infer<typeof FanoutSchema>;

/**
 * ผลรีวิวจาก HITL (Phase 4, เอกสาร 02 §8) — user กดใน dashboard แล้ว resume graph.
 * 'approve' → persist เขียน recs (status='suggested'); 'reject' → ทิ้ง draft ไม่เขียน.
 */
export type ReviewDecision = 'approve' | 'reject';

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
  // Phase 6: similarity = cosine กับหน้านี้ (VECTOR); null = ยังไม่มี embedding/ปิด Voyage
  cannibalizationCandidates: {
    pageId: number;
    url: string;
    position: number | null;
    similarity?: number | null;
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
  // Phase 3: queryFanout เขียน channel 'fanout' (≠ ชื่อโหนด 'queryFanout' — กัน collision)
  fanout: Annotation<Fanout>(),
  priority: Annotation<number>(),
  // Phase 4 (HITL): awaitReview เขียนหลัง resume — 'approve' (default) → persist เขียน recs,
  // 'reject' → persist ข้าม (ทิ้ง draft). undefined = HITL ปิด หรือยังไม่ถึง awaitReview.
  reviewDecision: Annotation<ReviewDecision>(),
  tokensIn: Annotation<number>({ reducer: sumReducer, default: () => 0 }),
  tokensOut: Annotation<number>({ reducer: sumReducer, default: () => 0 }),
});

export type PageAuditStateType = typeof PageAuditState.State;
