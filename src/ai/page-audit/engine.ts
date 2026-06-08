import { Command, isInterrupted } from '@langchain/langgraph';
import type { PageAuditGraph } from './graph';
import type { PageAuditStateType, ReviewDecision } from './state';
import type { ThreadCheckpointStore } from '../ai.tokens';

/** input เริ่ม run ของ graph (= state channels ที่ producer เตรียมให้ 1 job/เพจ). */
export interface PageAuditRunInput {
  pageId: number;
  projectId: number;
  runId: number;
  crawlId?: number;
}

export interface PageAuditRunResult {
  state: PageAuditStateType;
  /** true เมื่อ graph หยุดที่ awaitReview interrupt (HITL: รอ user อนุมัติใน dashboard). */
  interrupted: boolean;
}

/**
 * PageAuditEngine (Phase 4) — ห่อ compiled graph แล้วรวม coupling กับ langgraph
 * (invoke / isInterrupted / Command resume) + cleanup checkpoint ไว้ที่เดียว เพื่อให้ AiRunner
 * (orchestrate lifecycle ของ ai_runs) ไม่ต้อง import langgraph (jest import ไม่ได้). ไฟล์นี้
 * ไม่มี spec import — runner spec มॉค engine ผ่าน interface นี้ (เหมือนเดิมที่เคยมॉค graph).
 */
export class PageAuditEngine {
  constructor(
    private readonly graph: PageAuditGraph,
    private readonly checkpointer: ThreadCheckpointStore,
  ) {}

  private cfg(threadId: string) {
    // thread_id แยกต่อ run → checkpoint ไม่ชน + resume ตรง run ได้ (เอกสาร 02 §6)
    return { configurable: { thread_id: threadId } };
  }

  /** รัน graph ตั้งแต่ต้น. interrupted=true → หยุดที่ awaitReview (checkpoint persisted, รอ resume). */
  async run(
    input: PageAuditRunInput,
    threadId: string,
  ): Promise<PageAuditRunResult> {
    const state = await this.graph.invoke(input, this.cfg(threadId));
    return { state, interrupted: isInterrupted(state) };
  }

  /** resume graph ที่ค้างที่ awaitReview ด้วยผลรีวิว (approve/reject) → เดินต่อถึง persist. */
  async resume(
    threadId: string,
    decision: ReviewDecision,
  ): Promise<PageAuditStateType> {
    return await this.graph.invoke(
      new Command({ resume: { decision } }),
      this.cfg(threadId),
    );
  }

  /** ลบ checkpoint ของ thread (เรียกหลัง resume terminal — กัน checkpoints บวม). */
  async cleanup(threadId: string): Promise<void> {
    await this.checkpointer.deleteThread(threadId);
  }
}
