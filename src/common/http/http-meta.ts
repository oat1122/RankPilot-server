import type { ApiMeta } from './api-response.schema';

/** request ขั้นต่ำที่ buildMeta ต้องใช้ (req.id มาจาก pino-http ที่ main.ts ติดตั้งไว้). */
interface MetaRequest {
  id?: unknown;
  url?: string;
}

/**
 * อ่าน req.id (pino-http) + เวลา → meta กลาง. ใช้ร่วมทั้ง interceptor และ filter
 * เพื่อไม่ให้ logic ประกอบ meta ซ้ำสองที่ (เอกสาร 04 §6).
 * includePath: true เฉพาะตอน error (ช่วย debug ว่าพังที่ path ไหน).
 */
export function buildMeta(
  req: MetaRequest | undefined,
  opts: { includePath?: boolean } = {},
): ApiMeta {
  const meta: ApiMeta = { timestamp: new Date().toISOString() };
  // req.id เป็น unknown — stringify เฉพาะ string/number กัน '[object Object]' หลุดออกไป
  if (typeof req?.id === 'string' || typeof req?.id === 'number') {
    meta.requestId = String(req.id);
  }
  if (opts.includePath && req?.url) meta.path = req.url;
  return meta;
}
