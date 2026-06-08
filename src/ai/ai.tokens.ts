/**
 * DI tokens ของโดเมน ai. แยกไฟล์เพื่อให้ provider/consumer import token ได้โดยไม่ต้องดึง
 * โค้ดที่ผูก langgraph (graph.ts) เข้ามาในกราฟ import — สำคัญต่อ unit test (jest ไม่ parse
 * ESM ของ langgraph/uuid). compiled graph สร้างใน AiEngineModule แล้ว inject ผ่าน token นี้.
 */
export const PAGE_AUDIT_GRAPH = Symbol('PAGE_AUDIT_GRAPH');
