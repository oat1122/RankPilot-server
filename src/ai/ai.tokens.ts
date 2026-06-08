/**
 * DI tokens + interface ของโดเมน ai. แยกไฟล์เพื่อให้ provider/consumer import token ได้โดยไม่ต้อง
 * ดึงโค้ดที่ผูก langgraph (graph.ts/engine.ts/checkpoint) เข้ามาในกราฟ import — สำคัญต่อ unit test
 * (jest ไม่ parse ESM ของ langgraph/uuid). compiled graph + engine + saver สร้างใน AiEngineModule
 * แล้ว inject ผ่าน token เหล่านี้.
 */

/** PageAuditEngine (ห่อ compiled graph + invoke/isInterrupted/Command/cleanup). */
export const PAGE_AUDIT_ENGINE = Symbol('PAGE_AUDIT_ENGINE');

/**
 * subset ของ checkpointer ที่ AiRunner/engine ต้องใช้ (cleanup thread หลัง resume เสร็จ) —
 * แยก interface ที่ไม่ผูก langgraph type เพื่อให้ฝั่ง consumer (runner) langgraph-free.
 * MariaDbSaver (extends BaseCheckpointSaver) implement ครบอยู่แล้ว.
 */
export interface ThreadCheckpointStore {
  deleteThread(threadId: string): Promise<void>;
}
