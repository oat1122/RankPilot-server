import { END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import type { AIMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import {
  ContentGapSchema,
  CritiqueSchema,
  DiagnosisSchema,
  IntentSchema,
  MetaDraftSchema,
  PageAuditState,
} from './state';
import * as P from './prompts';
import { MAX_DRAFT, nextAfterCritique } from './critique-loop';
import type { Role } from '../llm/resolve';
import type { AiRepo } from '../ai.repo';

/** โหมด structured output (json_schema strict) + includeRaw เพื่ออ่าน token usage (เอกสาร 02 §2). */
const so = { method: 'jsonSchema', strict: true, includeRaw: true } as const;

export interface GraphDeps {
  repo: AiRepo;
  resolveModel: (role: Role) => ChatOpenAI;
  maxDraft?: number;
}

/** ดึง token usage จาก raw AIMessage (จาก includeRaw) — normalize เป็น {in,out}. */
function usageOf(raw: AIMessage): { tokensIn: number; tokensOut: number } {
  const u = raw.usage_metadata;
  return {
    tokensIn: Number(u?.input_tokens ?? 0),
    tokensOut: Number(u?.output_tokens ?? 0),
  };
}

/**
 * สร้าง compiled graph ของ page_audit — Phase 2 = ⊕ fan-out หลัง diagnose (เอกสาร 02 §5):
 *   loadContext → diagnose → (intentMatch ∥ contentGap) → draftMeta ⇄ critique (≤maxDraft)
 *                → prioritize → persist
 * intentMatch/contentGap รันขนานในซูเปอร์สเต็ปเดียว (เขียนคนละ channel + token มี reducer →
 * ไม่ชน) แล้ว fan-in ที่ draftMeta (รันรอบเดียวหลังครบทั้งสอง). draftMeta อ่าน intent/gaps จาก state.
 * checkpointer = MemorySaver (Phase 4 เปลี่ยนเป็น persistent + HITL interrupt).
 * deps ฉีดจากภายนอก (repo + resolveModel) → ทดสอบ/มॉคได้ และไม่อ่าน config/DB ตรงในโหนด.
 */
export function buildPageAuditGraph(deps: GraphDeps) {
  const maxDraft = deps.maxDraft ?? MAX_DRAFT;

  const g = new StateGraph(PageAuditState)
    .addNode('loadContext', async (s) => ({
      context: await deps.repo.loadPageContext(s.pageId, s.crawlId),
    }))
    .addNode('diagnose', async (s) => {
      const r = await deps
        .resolveModel('reasoner')
        .withStructuredOutput(DiagnosisSchema, so)
        .invoke(P.diagnose(s.context));
      return { diagnosis: r.parsed, ...usageOf(r.raw as AIMessage) };
    })
    // fan-out [1/2]: intent ตรงไหม + ยืนยัน cannibalization (เอกสาร 02 §0). channel 'intent'
    // ≠ ชื่อโหนด 'intentMatch' (LangGraph ห้าม node ชื่อซ้ำ state attribute).
    .addNode('intentMatch', async (s) => {
      const r = await deps
        .resolveModel('worker')
        .withStructuredOutput(IntentSchema, so)
        .invoke(P.intent(s.context, s.diagnosis));
      return { intent: r.parsed, ...usageOf(r.raw as AIMessage) };
    })
    // fan-out [2/2]: subtopic ที่ขาดเทียบคู่แข่งใน SERP. channel 'gaps' ≠ ชื่อโหนด 'contentGap'.
    .addNode('contentGap', async (s) => {
      const r = await deps
        .resolveModel('worker')
        .withStructuredOutput(ContentGapSchema, so)
        .invoke(P.gap(s.context, s.diagnosis));
      return { gaps: r.parsed.gaps, ...usageOf(r.raw as AIMessage) };
    })
    .addNode('draftMeta', async (s) => {
      const r = await deps
        .resolveModel('worker')
        .withStructuredOutput(MetaDraftSchema, so)
        .invoke(
          P.draft(s.context, s.diagnosis, s.critique, {
            intent: s.intent,
            gaps: s.gaps,
          }),
        );
      return {
        draft: r.parsed,
        draftAttempts: 1,
        ...usageOf(r.raw as AIMessage),
      };
    })
    // ชื่อโหนด ≠ ชื่อ channel: LangGraph ห้าม node ชื่อซ้ำกับ state attribute → ใช้ 'critiqueDraft'
    // (state field ยังชื่อ 'critique' ที่ prompts/recommendations/nextAfterCritique อ่าน).
    .addNode('critiqueDraft', async (s) => {
      const r = await deps
        .resolveModel('cheap')
        .withStructuredOutput(CritiqueSchema, so)
        .invoke(P.critique(s.draft, s.diagnosis));
      return { critique: r.parsed, ...usageOf(r.raw as AIMessage) };
    })
    .addNode('prioritize', (s) => {
      // impact = traffic_potential × business_potential (เอกสาร 02 §0 / §5)
      const tp = s.context.trafficPotential ?? s.context.pageTraffic ?? 0;
      const bp = s.context.businessPotential ?? 1;
      return { priority: Math.round(tp * bp) };
    })
    .addNode('persist', async (s) => {
      await deps.repo.persistRun(s);
      return {};
    });

  g.addEdge(START, 'loadContext');
  g.addEdge('loadContext', 'diagnose');
  // fan-out ขนานหลัง diagnose → fan-in ที่ draftMeta (รันรอบเดียวหลัง intentMatch+contentGap ครบ)
  g.addEdge('diagnose', 'intentMatch');
  g.addEdge('diagnose', 'contentGap');
  g.addEdge('intentMatch', 'draftMeta');
  g.addEdge('contentGap', 'draftMeta');
  g.addEdge('draftMeta', 'critiqueDraft');
  g.addConditionalEdges(
    'critiqueDraft',
    (s) => nextAfterCritique(s, maxDraft),
    {
      draftMeta: 'draftMeta',
      prioritize: 'prioritize',
    },
  );
  g.addEdge('prioritize', 'persist');
  g.addEdge('persist', END);

  return g.compile({ checkpointer: new MemorySaver() });
}

export type PageAuditGraph = ReturnType<typeof buildPageAuditGraph>;
