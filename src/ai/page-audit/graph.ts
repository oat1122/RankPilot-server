import { END, START, StateGraph, interrupt } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { AIMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import {
  ContentGapSchema,
  CritiqueSchema,
  DiagnosisSchema,
  FanoutSchema,
  IntentSchema,
  MetaDraftSchema,
  PageAuditState,
} from './state';
import * as P from './prompts';
import { MAX_DRAFT, nextAfterCritique } from './critique-loop';
import { normalizeResume, REVIEW_INTERRUPT_KIND } from './review';
import { toRecommendationRows } from './recommendations';
import type { Role } from '../llm/resolve';
import type { AiRepo } from '../ai.repo';

/** โหมด structured output (json_schema strict) + includeRaw เพื่ออ่าน token usage (เอกสาร 02 §2). */
const so = { method: 'jsonSchema', strict: true, includeRaw: true } as const;

/** ผลของ prep ต่อโหนด (Phase 5): model ต่อโปรเจค + skills text ที่ render แล้ว. */
export interface NodePrep {
  llm: ChatOpenAI;
  skills: string;
}

export interface GraphDeps {
  repo: AiRepo;
  /**
   * Phase 5: resolve (model ต่อโปรเจค จาก ai_settings) + (skills ที่ apply กับ node นี้ จาก ai_skills,
   * render แล้ว) ในครั้งเดียว. node = ชื่อ .addNode (diagnose/intentMatch/contentGap/draftMeta/
   * critiqueDraft/queryFanout) → ใช้เป็น skill target (appliesTo). resolve ตอน invoke (รู้ projectId).
   */
  prep: (projectId: number, role: Role, node: string) => Promise<NodePrep>;
  /** Phase 4: persistent checkpointer (MariaDbSaver) แทน MemorySaver → resume ข้าม process ได้. */
  checkpointer: BaseCheckpointSaver;
  /** Phase 4: true → awaitReview interrupt ก่อน persist (HITL); false → ผ่านตรงไป persist. */
  hitl?: boolean;
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
 * สร้าง compiled graph ของ page_audit — Phase 4 = ⊕ awaitReview (HITL) + persistent checkpointer
 * (เอกสาร 02 §5/§6):
 *   loadContext → diagnose → (intentMatch ∥ contentGap) → draftMeta ⇄ critique (≤maxDraft)
 *                → queryFanout → prioritize → awaitReview → persist
 * intentMatch/contentGap รันขนานในซูเปอร์สเต็ปเดียว (เขียนคนละ channel + token มี reducer →
 * ไม่ชน) แล้ว fan-in ที่ draftMeta (รันรอบเดียวหลังครบทั้งสอง). draftMeta อ่าน intent/gaps จาก state.
 * queryFanout (worker) เดิน sequential หลัง critique loop จบ แล้วป้อน prioritize.
 * awaitReview (HITL): hitl=true → interrupt() รอ user อนุมัติใน dashboard (resume ผ่าน Command),
 * hitl=false → ผ่านเลย. topology คงที่ (prioritize→awaitReview→persist) ทุกกรณี เพื่อให้ type ของ node
 * คงที่ + ไม่มี unreachable node. checkpointer ฉีดจากภายนอก (MariaDbSaver) → resume ข้าม process ได้.
 * Phase 5: โหนด LLM เรียก deps.prep(projectId,role,node) → model ต่อโปรเจค (ai_settings) + skills
 * รายโหนด (ai_skills). deps ฉีดจากภายนอก (repo + prep + checkpointer) → ทดสอบ/มॉคได้ ไม่อ่าน config/DB ตรงในโหนด.
 */
export function buildPageAuditGraph(deps: GraphDeps) {
  const maxDraft = deps.maxDraft ?? MAX_DRAFT;
  const hitl = deps.hitl ?? true;

  const g = new StateGraph(PageAuditState)
    .addNode('loadContext', async (s) => ({
      context: await deps.repo.loadPageContext(s.pageId, s.crawlId),
    }))
    .addNode('diagnose', async (s) => {
      const { llm, skills } = await deps.prep(
        s.projectId,
        'reasoner',
        'diagnose',
      );
      const r = await llm
        .withStructuredOutput(DiagnosisSchema, so)
        .invoke(P.diagnose(s.context, { skills }));
      return { diagnosis: r.parsed, ...usageOf(r.raw as AIMessage) };
    })
    // fan-out [1/2]: intent ตรงไหม + ยืนยัน cannibalization (เอกสาร 02 §0). channel 'intent'
    // ≠ ชื่อโหนด 'intentMatch' (LangGraph ห้าม node ชื่อซ้ำ state attribute).
    .addNode('intentMatch', async (s) => {
      const { llm, skills } = await deps.prep(
        s.projectId,
        'worker',
        'intentMatch',
      );
      const r = await llm
        .withStructuredOutput(IntentSchema, so)
        .invoke(P.intent(s.context, s.diagnosis, { skills }));
      return { intent: r.parsed, ...usageOf(r.raw as AIMessage) };
    })
    // fan-out [2/2]: subtopic ที่ขาดเทียบคู่แข่งใน SERP. channel 'gaps' ≠ ชื่อโหนด 'contentGap'.
    .addNode('contentGap', async (s) => {
      const { llm, skills } = await deps.prep(
        s.projectId,
        'worker',
        'contentGap',
      );
      const r = await llm
        .withStructuredOutput(ContentGapSchema, so)
        .invoke(P.gap(s.context, s.diagnosis, { skills }));
      return { gaps: r.parsed.gaps, ...usageOf(r.raw as AIMessage) };
    })
    .addNode('draftMeta', async (s) => {
      const { llm, skills } = await deps.prep(
        s.projectId,
        'worker',
        'draftMeta',
      );
      const r = await llm
        .withStructuredOutput(MetaDraftSchema, so)
        .invoke(
          P.draft(
            s.context,
            s.diagnosis,
            s.critique,
            { intent: s.intent, gaps: s.gaps },
            { skills },
          ),
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
      const { llm, skills } = await deps.prep(
        s.projectId,
        'cheap',
        'critiqueDraft',
      );
      const r = await llm
        .withStructuredOutput(CritiqueSchema, so)
        .invoke(P.critique(s.draft, s.diagnosis, { skills }));
      return { critique: r.parsed, ...usageOf(r.raw as AIMessage) };
    })
    // Phase 3: เดา sub-question ของ AI search → FAQ/schema. channel 'fanout' ≠ ชื่อโหนด
    // 'queryFanout' (LangGraph ห้าม node ชื่อซ้ำ state attribute).
    .addNode('queryFanout', async (s) => {
      const { llm, skills } = await deps.prep(
        s.projectId,
        'worker',
        'queryFanout',
      );
      const r = await llm
        .withStructuredOutput(FanoutSchema, so)
        .invoke(P.fanout(s.context, s.diagnosis, { skills }));
      return { fanout: r.parsed, ...usageOf(r.raw as AIMessage) };
    })
    .addNode('prioritize', (s) => {
      // impact = traffic_potential × business_potential (เอกสาร 02 §0 / §5)
      const tp = s.context.trafficPotential ?? s.context.pageTraffic ?? 0;
      const bp = s.context.businessPotential ?? 1;
      return { priority: Math.round(tp * bp) };
    })
    // Phase 4 (HITL): หยุดรอ user อนุมัติใน dashboard. hitl=true → interrupt() รอบแรกโยน
    // GraphInterrupt → graph pause + checkpoint persist (รอ resume); รอบ resume คืน resume value
    // (Command) → normalize เป็น decision เขียน channel reviewDecision (persist อ่านไป gate การเขียน).
    // hitl=false → ผ่านเลย (reviewDecision=undefined → isApproved=true → persist เขียนตามเดิม).
    .addNode('awaitReview', (s) => {
      if (!hitl) return {};
      // interrupt() คืน any (resume value) → annotate unknown ให้ normalizeResume คุม shape
      const resume: unknown = interrupt({
        kind: REVIEW_INTERRUPT_KIND,
        proposal: toRecommendationRows(s),
      });
      return { reviewDecision: normalizeResume(resume) };
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
  // critique จบ (pass หรือครบ maxDraft) → queryFanout, ไม่งั้น loop กลับ draftMeta
  g.addConditionalEdges(
    'critiqueDraft',
    (s) => nextAfterCritique(s, maxDraft),
    {
      draftMeta: 'draftMeta',
      queryFanout: 'queryFanout',
    },
  );
  g.addEdge('queryFanout', 'prioritize');
  // Phase 4: prioritize → awaitReview → persist เสมอ (awaitReview ตัดสินใน node ว่าจะ interrupt ไหม)
  g.addEdge('prioritize', 'awaitReview');
  g.addEdge('awaitReview', 'persist');
  g.addEdge('persist', END);

  return g.compile({ checkpointer: deps.checkpointer });
}

export type PageAuditGraph = ReturnType<typeof buildPageAuditGraph>;
