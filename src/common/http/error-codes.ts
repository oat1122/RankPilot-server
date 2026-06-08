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
  // Projects (เอกสาร 01 §2) — ใช้กับ list/detail + ownership guard. 404 (ไม่ใช่ 403) เมื่อไม่ใช่
  // เจ้าของ เพื่อไม่เปิดเผยว่า projectId นั้นมีจริง (กัน enumeration ข้าม tenant).
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  // Ahrefs Enrichment (เอกสาร 03) — งบ units/rate-limit/upstream ของ Ahrefs API v3
  AHREFS_JOB_NOT_FOUND: 'AHREFS_JOB_NOT_FOUND',
  AHREFS_BUDGET_EXCEEDED: 'AHREFS_BUDGET_EXCEEDED', // เกินเพดาน units/เดือน (กันก่อนยิง)
  AHREFS_RATE_LIMITED: 'AHREFS_RATE_LIMITED', // Ahrefs ตอบ 429
  AHREFS_UNAUTHORIZED: 'AHREFS_UNAUTHORIZED', // key หาย/ผิด (401/403)
  AHREFS_API_ERROR: 'AHREFS_API_ERROR', // upstream ล้ม (5xx/อื่น ๆ)
  // Analysis (เอกสาร 04 §7) — stage [3] วิเคราะห์ crawl/enrich → seo_scores + audit_findings
  ANALYSIS_JOB_NOT_FOUND: 'ANALYSIS_JOB_NOT_FOUND', // jobId ที่ขอสถานะไม่มีใน queue 'analysis'
  ANALYSIS_NO_CRAWL: 'ANALYSIS_NO_CRAWL', // โปรเจคยังไม่มี crawl ให้วิเคราะห์ (ต้อง crawl ก่อน)
  // AI Advisor (เอกสาร 02) — stage [4] รัน graph page_audit ผ่าน OpenRouter (live)
  AI_JOB_NOT_FOUND: 'AI_JOB_NOT_FOUND', // jobId ที่ขอสถานะไม่มีใน queue 'ai'
  AI_NO_CRAWL: 'AI_NO_CRAWL', // ไม่มี crawl/page ให้ audit (ต้อง crawl ก่อน)
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED', // OPENROUTER_API_KEY ไม่ได้ตั้งค่า (เอกสาร 02 §9)
  AI_RUN_NOT_FOUND: 'AI_RUN_NOT_FOUND', // runId ที่ขอ review ไม่มี/ไม่ใช่โปรเจคนี้ (Phase 4 HITL)
  AI_RUN_NOT_REVIEWABLE: 'AI_RUN_NOT_REVIEWABLE', // run ไม่ได้อยู่สถานะ awaiting_review (Phase 4)
  AI_SKILL_NOT_FOUND: 'AI_SKILL_NOT_FOUND', // skillId ที่ขอแก้/toggle ไม่มี (Phase 5)
  EMBEDDING_NOT_CONFIGURED: 'EMBEDDING_NOT_CONFIGURED', // VOYAGE_API_KEY ไม่ได้ตั้งค่า (Phase 6)
  // UserManager (เอกสาร 05 §4) — ปิด self sign-up + RBAC admin/user ผ่าน /users
  USER_NOT_FOUND: 'USER_NOT_FOUND', // userId ที่ admin ขอจัดการไม่มี
  USER_NOT_PROVISIONED: 'USER_NOT_PROVISIONED', // login สำเร็จแต่ไม่อยู่ allowlist/ไม่ถูกเชิญ → ปฏิเสธ
  USER_DISABLED: 'USER_DISABLED', // บัญชีถูก admin soft-disable (status=disabled)
  USER_EMAIL_EXISTS: 'USER_EMAIL_EXISTS', // เชิญ/สร้าง user ด้วย email ที่มีอยู่แล้ว
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
  PROJECT_NOT_FOUND: HttpStatus.NOT_FOUND,
  AHREFS_JOB_NOT_FOUND: HttpStatus.NOT_FOUND,
  AHREFS_BUDGET_EXCEEDED: HttpStatus.TOO_MANY_REQUESTS,
  AHREFS_RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  AHREFS_UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  AHREFS_API_ERROR: HttpStatus.BAD_GATEWAY,
  ANALYSIS_JOB_NOT_FOUND: HttpStatus.NOT_FOUND,
  ANALYSIS_NO_CRAWL: HttpStatus.UNPROCESSABLE_ENTITY,
  AI_JOB_NOT_FOUND: HttpStatus.NOT_FOUND,
  AI_NO_CRAWL: HttpStatus.UNPROCESSABLE_ENTITY,
  AI_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  AI_RUN_NOT_FOUND: HttpStatus.NOT_FOUND,
  AI_RUN_NOT_REVIEWABLE: HttpStatus.CONFLICT,
  AI_SKILL_NOT_FOUND: HttpStatus.NOT_FOUND,
  EMBEDDING_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  USER_NOT_FOUND: HttpStatus.NOT_FOUND,
  USER_NOT_PROVISIONED: HttpStatus.FORBIDDEN,
  USER_DISABLED: HttpStatus.FORBIDDEN,
  USER_EMAIL_EXISTS: HttpStatus.CONFLICT,
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
  PROJECT_NOT_FOUND: 'Project not found',
  AHREFS_JOB_NOT_FOUND: 'Ahrefs enrichment job not found',
  AHREFS_BUDGET_EXCEEDED: 'Ahrefs monthly unit budget exceeded',
  AHREFS_RATE_LIMITED: 'Ahrefs API rate limited',
  AHREFS_UNAUTHORIZED: 'Ahrefs API key missing or invalid',
  AHREFS_API_ERROR: 'Ahrefs API request failed',
  ANALYSIS_JOB_NOT_FOUND: 'Analysis job not found',
  ANALYSIS_NO_CRAWL: 'No crawl available to analyze — run a crawl first',
  AI_JOB_NOT_FOUND: 'AI job not found',
  AI_NO_CRAWL: 'No crawl available to audit — run a crawl first',
  AI_NOT_CONFIGURED:
    'AI advisor not configured — OPENROUTER_API_KEY is missing',
  AI_RUN_NOT_FOUND: 'AI run not found',
  AI_RUN_NOT_REVIEWABLE: 'AI run is not awaiting review',
  AI_SKILL_NOT_FOUND: 'AI skill not found',
  EMBEDDING_NOT_CONFIGURED:
    'Embeddings not configured — VOYAGE_API_KEY is missing',
  USER_NOT_FOUND: 'User not found',
  USER_NOT_PROVISIONED: 'User is not provisioned — contact an administrator',
  USER_DISABLED: 'User account is disabled',
  USER_EMAIL_EXISTS: 'A user with this email already exists',
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
