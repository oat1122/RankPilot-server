import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import type { Response } from 'express';
import { AppException } from './app.exception';
import {
  ERROR_DEFAULT_MESSAGE,
  ErrorCode,
  statusToErrorCode,
} from './error-codes';
import { ApiErrorBody, fail } from './api-response.schema';
import { buildMeta } from './http-meta';

/**
 * จุดเดียวที่แปลง "ทุก" exception → error envelope กลาง (เอกสาร 04 §6).
 *
 * ลำดับการ map (จากเจาะจง → กว้าง):
 *  1) ZodValidationException — body/query ไม่ผ่าน Zod (จาก ZodValidationPipe global)
 *  2) AppException          — โค้ดเรา throw เอง (มี code/details ติดมาแล้ว)
 *  3) HttpException ดิบ      — NotFoundException ฯลฯ จาก Nest/lib → map status เป็น code
 *  4) Error/อื่น ๆ          — 500 ไม่เผย internal ออก response, log stack ฝั่ง server
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<{ id?: unknown; url?: string }>();
    const meta = buildMeta(req, { includePath: true });

    const { status, body } = this.toError(exception);

    // 5xx = ฝั่งเรา → log stack เต็มไว้ debug (response ส่งแค่ message generic)
    if (status >= 500) {
      this.logger.error(
        `[${meta.requestId ?? '-'}] ${body.code}: ${describe(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    res.status(status).json(fail(body, meta));
  }

  private toError(exception: unknown): { status: number; body: ApiErrorBody } {
    // 1) Zod validation — แตก field-level issues ให้ FE ชี้ตำแหน่ง error ได้
    if (exception instanceof ZodValidationException) {
      // getZodError() เป็น unknown (nestjs-zod) → narrow เอาเฉพาะ issues ที่ต้องใช้
      const zodError = exception.getZodError() as {
        issues?: { path: (string | number)[]; message: string }[];
      };
      const issues = zodError?.issues;
      const details = Array.isArray(issues)
        ? issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
        : undefined;
      return {
        status: exception.getStatus(), // 400 (BadRequest) ตาม nestjs-zod
        body: {
          code: ErrorCode.VALIDATION_FAILED,
          message: ERROR_DEFAULT_MESSAGE.VALIDATION_FAILED,
          details,
        },
      };
    }

    // 2) AppException — มี code/message/details เป็น semantic อยู่แล้ว
    if (exception instanceof AppException) {
      const payload = exception.getResponse() as {
        code: ErrorCode;
        message: string;
        details?: unknown;
      };
      return {
        status: exception.getStatus(),
        body: {
          code: payload.code,
          message: payload.message,
          details: payload.details,
        },
      };
    }

    // 3) HttpException ดิบ → map status → code กลาง
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        body: {
          code: statusToErrorCode(status),
          message: extractMessage(exception),
        },
      };
    }

    // 4) ไม่ใช่ HttpException (bug/Error หลุด) → 500 generic
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ErrorCode.INTERNAL_ERROR,
        message: ERROR_DEFAULT_MESSAGE.INTERNAL_ERROR,
      },
    };
  }
}

function describe(exception: unknown): string {
  return exception instanceof Error ? exception.message : String(exception);
}

/** ดึงข้อความจาก HttpException (response เป็น string | { message } | { message: string[] }). */
function extractMessage(exception: HttpException): string {
  const resp = exception.getResponse();
  if (typeof resp === 'string') return resp;
  if (resp && typeof resp === 'object' && 'message' in resp) {
    const m = resp.message;
    if (Array.isArray(m)) return m.join('; ');
    if (typeof m === 'string') return m;
  }
  return exception.message;
}
