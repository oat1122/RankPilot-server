import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Envelope กลางของทุก response FE↔BE (เอกสาร 04 §6 — Zod ตัวเดียว ประกาศครั้งเดียว,
 * ตั้งใจย้ายไป packages/shared ภายหลังให้ web import ใช้ type ร่วมกัน).
 *
 * รูปคงที่: สำเร็จ → { success:true, data, meta } / ล้มเหลว → { success:false, error, meta }.
 * FE เช็ค `success` ก่อนเสมอ แล้วจึงเข้าถึง data หรือ error.code อย่างปลอดภัย (discriminated union).
 */
export const apiMetaSchema = z.object({
  timestamp: z.string(), // ISO 8601 เวลาที่ตอบ
  requestId: z.string().optional(), // = req.id (pino-http) — trace ข้าม FE ↔ log
  path: z.string().optional(), // path ที่เรียก (ใส่เฉพาะตอน error)
});

export const apiErrorBodySchema = z.object({
  code: z.string(), // รหัสจาก ErrorCode catalog — FE ใช้ branch
  message: z.string(), // ข้อความสำหรับ debug/แสดงผล (อาจเปลี่ยน/แปลได้ — อย่า branch ด้วยอันนี้)
  details: z.unknown().optional(), // field-level issues (validation) ฯลฯ
});

export const apiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: apiErrorBodySchema,
  meta: apiMetaSchema,
});

/**
 * base ของ success (ไม่รวม `data`) — Swagger เอาไปประกอบ allOf กับ data ของแต่ละ
 * endpoint (ดู swagger.ts) เพื่อเลี่ยงประกาศ generic ซ้ำทุกที่.
 */
export const apiSuccessBaseSchema = z.object({
  success: z.literal(true),
  meta: apiMetaSchema,
});

export type ApiMeta = z.infer<typeof apiMetaSchema>;
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}
export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
  meta: ApiMeta;
}
/** union ที่ FE ใช้ — narrow ด้วย field `success`. */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/** helper ประกอบ envelope — ใช้ใน interceptor (success) และ filter (error). */
export function ok<T>(data: T, meta: ApiMeta): ApiSuccessResponse<T> {
  return { success: true, data, meta };
}
export function fail(error: ApiErrorBody, meta: ApiMeta): ApiErrorResponse {
  return { success: false, error, meta };
}

/** DTO สำหรับ Swagger (ลง schema ใน OpenAPI → generate TS client ให้ web เอกสาร 04 §6). */
export class ApiErrorResponseDto extends createZodDto(apiErrorResponseSchema) {}
export class ApiSuccessBaseDto extends createZodDto(apiSuccessBaseSchema) {}
