import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  ContentGaps,
  Critique,
  Diagnosis,
  Intent,
  MetaDraft,
  PageContext,
} from './state';

/**
 * Prompt builders — เอกสาร 02 §7. แต่ละ builder = skills prefix + system rules + JSON context.
 * structured output (Zod→json_schema) คุม shape ของผลลัพธ์แทน parse เอง.
 * Phase 1 ส่ง skills=undefined (ระบบ Skills อยู่ Phase 5) แต่เซ็น signature เผื่อไว้แล้ว.
 */

export interface PromptOpts {
  skills?: string;
}

/** วาง skills ไว้บนสุดของ system message เสมอ (cached prefix — เอกสาร 02 §7). */
function sys(body: string, opt?: PromptOpts): string {
  return [opt?.skills, body].filter(Boolean).join('\n\n');
}

const DIAGNOSE_RULES = `คุณเป็นที่ปรึกษา SEO มืออาชีพ. วิเคราะห์ on-page + สัญญาณ ranking ของหน้านี้.
- เลือก primaryKeyword ที่ควร target (อิง search volume × ความเหมาะกับเนื้อหา).
- สรุป issues ที่พบ พร้อม severity (low/medium/high/critical) และ note สั้น ๆ.
- ห้ามแนะนำลบหน้าโดยไม่พิจารณา intent.
อธิบาย reasoning เป็นภาษาไทย.`;

const DRAFT_RULES = `ร่าง title ≤ 60 ตัวอักษร และ metaDescription ≤ 155 ตัวอักษร เป็นภาษาไทย.
- ใส่ primary keyword ไว้ต้นประโยค, ไม่ clickbait, อ่านออกเสียงแล้วลื่น.
- ใช้ intent (search intent ของ keyword) ให้ title/meta สื่อ intent นั้นชัด.
- ถ้ามี contentGaps (subtopic ที่ขาด) ให้สะท้อนประเด็นสำคัญที่ขาดลงใน meta เพื่อดึงความครอบคลุม.
- ถ้ามี critiqueProblems ให้แก้ตามนั้นทุกข้อ.
- rationale อธิบายเหตุผลที่เลือกถ้อยคำ.`;

const INTENT_RULES = `วิเคราะห์ว่า content ของหน้านี้ตรงกับ search intent ของ primary keyword หรือไม่.
- ระบุ intent ที่แท้จริงของ keyword (informational/navigational/commercial/transactional).
- matches=true เมื่อเนื้อหาตอบ intent นั้น, ไม่งั้น false.
- ถ้า context.cannibalizationCandidates มีเพจอื่น (โปรเจคเดียวกันที่ rank คีย์เดียวกัน):
  ตัดสิน cannibalizationReal=true เมื่อเพจเหล่านั้น target intent เดียวกัน (แย่งอันดับกันจริง),
  =false เมื่อ intent ต่างกัน (ไม่ใช่ปัญหา). ถ้าไม่มี candidate ให้ cannibalizationReal=null.
- note อธิบายเหตุผลเป็นภาษาไทยสั้น ๆ.`;

const GAP_RULES = `เทียบโครงเนื้อหา (headings) ของหน้าเรากับหน้าคู่แข่งที่ติด SERP (context.competitors: domain/url).
- ระบุ subtopic ที่คู่แข่งน่าจะครอบคลุมแต่หน้าเรายังขาด (อิง url/slug/โดเมนคู่แข่ง + ความรู้ทั่วไปของหัวข้อ).
- แต่ละ gap: subtopic + competitors (โดเมนที่น่าจะครอบคลุม subtopic นั้น).
- ถ้าไม่มีคู่แข่งให้เทียบ ให้เสนอ subtopic ที่ควรเพิ่มจาก intent/diagnosis (competitors=[]).
- เน้น subtopic ที่เพิ่มโอกาสติดอันดับ/ถูก cite ใน AI search. คืน gaps เป็น array (ว่างได้ถ้าครบแล้ว).`;

const CRITIQUE_RULES = `ตรวจ draft ที่ให้มาอย่างเข้มงวด:
- title ยาวเกิน 60 ตัวอักษรไหม? metaDescription เกิน 155 ไหม?
- primary keyword หายไปไหม? มีคำซ้ำ/เยิ่นเย้อไหม? เป็นภาษาไทยลื่นไหม?
คืน pass=true เฉพาะเมื่อผ่านทุกข้อ; ไม่งั้น pass=false พร้อม problems ที่ต้องแก้ (ชี้เฉพาะเจาะจง).`;

const FANOUT_RULES = `คุณเชี่ยวชาญ AI search optimization. คาดเดาว่าผู้ใช้ AI search (ChatGPT/Perplexity/Google AI)
จะถาม sub-question อะไรบ้างกับหัวข้อของหน้านี้ เพื่อให้เราเพิ่ม section/FAQ ให้เนื้อหาถูกหยิบไป cite.
- subQuestions: คำถามย่อยที่เกี่ยวข้องกับ primary keyword/intent (อิง diagnosis + เนื้อหาหน้า), เป็นภาษาไทย,
  เจาะจง ตอบได้จริง, เรียงจากที่คนถามบ่อยสุด. เลี่ยงคำถามกว้างเกินหรือซ้ำกัน.
- suggestedSchema: structured-data schema ที่ควรใส่เพื่อให้ถูก cite — เลือกจาก FAQPage (เมื่อมีชุด Q&A),
  HowTo (เมื่อเป็นขั้นตอน), Article (เนื้อหาทั่วไป). เลือกเฉพาะที่เหมาะกับเนื้อหาจริง (ว่างได้ถ้าไม่เหมาะ).`;

/** diagnose (reasoner) — สรุปปัญหา + primary keyword (เอกสาร 02 §7). */
export function diagnose(ctx: PageContext, opt?: PromptOpts): BaseMessage[] {
  return [
    new SystemMessage(sys(DIAGNOSE_RULES, opt)),
    new HumanMessage(JSON.stringify(ctx)),
  ];
}

/** intentMatch (worker) — intent ตรงไหม + ยืนยัน cannibalization (เอกสาร 02 §7, Phase 2). */
export function intent(
  ctx: PageContext,
  diagnosis: Diagnosis,
  opt?: PromptOpts,
): BaseMessage[] {
  return [
    new SystemMessage(sys(INTENT_RULES, opt)),
    new HumanMessage(JSON.stringify({ context: ctx, diagnosis })),
  ];
}

/** contentGap (worker) — subtopic ที่ขาดเทียบคู่แข่งใน SERP (เอกสาร 02 §7, Phase 2). */
export function gap(
  ctx: PageContext,
  diagnosis: Diagnosis,
  opt?: PromptOpts,
): BaseMessage[] {
  return [
    new SystemMessage(sys(GAP_RULES, opt)),
    new HumanMessage(JSON.stringify({ context: ctx, diagnosis })),
  ];
}

/**
 * draftMeta (worker) — ร่าง title/meta อิง intent/gaps จาก fan-out; ถ้ามี critique.problems
 * ให้แก้ตามนั้น (เอกสาร 02 §7). extra = ผลจาก Phase 2 (intentMatch/contentGap).
 */
export function draft(
  ctx: PageContext,
  diagnosis: Diagnosis,
  critique: Critique | undefined,
  extra?: { intent?: Intent; gaps?: ContentGaps['gaps'] },
  opt?: PromptOpts,
): BaseMessage[] {
  const payload = {
    context: ctx,
    diagnosis,
    intent: extra?.intent ?? null,
    contentGaps: extra?.gaps ?? [],
    critiqueProblems: critique?.problems ?? [],
  };
  return [
    new SystemMessage(sys(DRAFT_RULES, opt)),
    new HumanMessage(JSON.stringify(payload)),
  ];
}

/** critique (cheap) — ตรวจกฎ title/meta แล้วคืน pass + problems (เอกสาร 02 §7). */
export function critique(
  draftValue: MetaDraft,
  diagnosis: Diagnosis,
  opt?: PromptOpts,
): BaseMessage[] {
  return [
    new SystemMessage(sys(CRITIQUE_RULES, opt)),
    new HumanMessage(JSON.stringify({ draft: draftValue, diagnosis })),
  ];
}

/** queryFanout (worker) — sub-question ของ AI search → FAQ/schema (เอกสาร 02 §7, Phase 3). */
export function fanout(
  ctx: PageContext,
  diagnosis: Diagnosis,
  opt?: PromptOpts,
): BaseMessage[] {
  return [
    new SystemMessage(sys(FANOUT_RULES, opt)),
    new HumanMessage(JSON.stringify({ context: ctx, diagnosis })),
  ];
}
