import { HttpException } from '@nestjs/common';
import { ERROR_DEFAULT_MESSAGE, ERROR_STATUS, ErrorCode } from './error-codes';

/**
 * Exception กลางของแอป — โยนด้วย "ความหมาย" (ErrorCode) ไม่ใช่ HTTP status ดิบ.
 *
 * ใช้แทน NotFoundException/BadRequestException ฯลฯ เพื่อให้ FE ได้ error.code คงที่
 * (เอกสาร 04 §6). AllExceptionsFilter อ่าน payload นี้ตรง ๆ แล้วแปลงเป็น error envelope —
 * status ดึงจาก ERROR_STATUS[code] อัตโนมัติ ไม่ต้องจำ number.
 *
 * ตัวอย่าง: `throw new AppException(ErrorCode.CRAWL_JOB_NOT_FOUND, 'crawl job 9 not found')`.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: unknown,
  ) {
    super(
      { code, message: message ?? ERROR_DEFAULT_MESSAGE[code], details },
      ERROR_STATUS[code],
    );
  }
}
