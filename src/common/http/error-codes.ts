import { HttpStatus } from '@nestjs/common';

/**
 * Error catalog กลาง (เอกสาร 04 §6 — enum/contract ประกาศครั้งเดียว ใช้ร่วม FE↔BE).
 *
 * โค้ดธุรกิจ throw ด้วย AppException(code) แทน HttpException ดิบ → response ฝั่ง FE
 * ได้รูป { error.code } คงที่ ใช้ branch logic ได้ โดยไม่ต้อง parse ข้อความภาษามนุษย์
 * (ซึ่งเปลี่ยน/แปลภาษาได้). value = type เดียวกัน (declaration merge) เพื่อ import ที่เดียว.
 */
export const ErrorCode = {
  // ทั่วไป (map กับ HTTP status มาตรฐาน)
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  RATE_LIMITED: 'RATE_LIMITED',
  HTTP_ERROR: 'HTTP_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // โครงสร้างพื้นฐานล่ม (Redis/queue/DB) → 503 ให้ FE retry ได้ ไม่ใช่ bug ของ request
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  // เฉพาะโดเมน — เพิ่มได้เรื่อย ๆ ตาม feature
  CRAWL_JOB_NOT_FOUND: 'CRAWL_JOB_NOT_FOUND',
  // Ahrefs Enrichment (เอกสาร 03) — งบ units/rate-limit/upstream ของ Ahrefs API v3
  AHREFS_JOB_NOT_FOUND: 'AHREFS_JOB_NOT_FOUND',
  AHREFS_BUDGET_EXCEEDED: 'AHREFS_BUDGET_EXCEEDED', // เกินเพดาน units/เดือน (กันก่อนยิง)
  AHREFS_RATE_LIMITED: 'AHREFS_RATE_LIMITED', // Ahrefs ตอบ 429
  AHREFS_UNAUTHORIZED: 'AHREFS_UNAUTHORIZED', // key หาย/ผิด (401/403)
  AHREFS_API_ERROR: 'AHREFS_API_ERROR', // upstream ล้ม (5xx/อื่น ๆ)
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** code → HTTP status — ใช้โดย AppException (ตอน throw). */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  UNPROCESSABLE_ENTITY: HttpStatus.UNPROCESSABLE_ENTITY,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  HTTP_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
  SERVICE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  CRAWL_JOB_NOT_FOUND: HttpStatus.NOT_FOUND,
  AHREFS_JOB_NOT_FOUND: HttpStatus.NOT_FOUND,
  AHREFS_BUDGET_EXCEEDED: HttpStatus.TOO_MANY_REQUESTS,
  AHREFS_RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  AHREFS_UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  AHREFS_API_ERROR: HttpStatus.BAD_GATEWAY,
};

/** ข้อความ default ต่อ code (override ได้ตอน throw). */
export const ERROR_DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Validation failed',
  BAD_REQUEST: 'Bad request',
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Resource not found',
  CONFLICT: 'Conflict',
  UNPROCESSABLE_ENTITY: 'Unprocessable entity',
  RATE_LIMITED: 'Too many requests',
  HTTP_ERROR: 'Request failed',
  INTERNAL_ERROR: 'Internal server error',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable',
  CRAWL_JOB_NOT_FOUND: 'Crawl job not found',
  AHREFS_JOB_NOT_FOUND: 'Ahrefs enrichment job not found',
  AHREFS_BUDGET_EXCEEDED: 'Ahrefs monthly unit budget exceeded',
  AHREFS_RATE_LIMITED: 'Ahrefs API rate limited',
  AHREFS_UNAUTHORIZED: 'Ahrefs API key missing or invalid',
  AHREFS_API_ERROR: 'Ahrefs API request failed',
};

/** lookup: HTTP status → ErrorCode (เฉพาะที่ map ตรง ๆ ได้). */
const STATUS_CODE_MAP: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.UNPROCESSABLE_ENTITY,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

/**
 * map HTTP status → ErrorCode กลาง — ใช้ตอน filter เจอ HttpException ดิบ
 * (NotFoundException ฯลฯ จาก Nest หรือ lib) ที่ไม่มี code ของเราติดมา.
 * fallback: 5xx → INTERNAL_ERROR, 4xx อื่น → HTTP_ERROR.
 */
export function statusToErrorCode(status: number): ErrorCode {
  return (
    STATUS_CODE_MAP[status] ??
    (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.HTTP_ERROR)
  );
}
