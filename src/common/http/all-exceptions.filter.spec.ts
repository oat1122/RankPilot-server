import { ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppException } from './app.exception';
import { ErrorCode } from './error-codes';
import type { ApiErrorResponse } from './api-response.schema';

/** จำลอง ArgumentsHost (express) + เก็บ status/json ที่ filter เรียก. */
function mockHost(): {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ id: 'req-1', url: '/crawls/9' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

/** อ่าน error envelope ที่ filter ส่งเข้า res.json() แบบ typed (เลี่ยง any). */
function sentBody(json: jest.Mock): ApiErrorResponse {
  const calls = json.mock.calls as unknown[][];
  return calls[0][0] as ApiErrorResponse;
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('AppException → status + error.code จาก catalog + meta.path', () => {
    const { host, status, json } = mockHost();

    filter.catch(
      new AppException(ErrorCode.CRAWL_JOB_NOT_FOUND, 'crawl job 9 not found'),
      host,
    );

    expect(status).toHaveBeenCalledWith(404);
    const body = sentBody(json);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(ErrorCode.CRAWL_JOB_NOT_FOUND);
    expect(body.error.message).toBe('crawl job 9 not found');
    expect(body.meta.requestId).toBe('req-1');
    expect(body.meta.path).toBe('/crawls/9');
  });

  it('HttpException ดิบ (NotFoundException) → map status เป็น code กลาง', () => {
    const { host, status, json } = mockHost();

    filter.catch(new NotFoundException('nope'), host);

    expect(status).toHaveBeenCalledWith(404);
    const body = sentBody(json);
    expect(body.error.code).toBe(ErrorCode.NOT_FOUND);
    expect(body.error.message).toBe('nope');
  });

  it('ZodValidationException → 400 VALIDATION_FAILED + details field-level', () => {
    const { host, status, json } = mockHost();
    const zodError = z.object({ url: z.string() }).safeParse({}).error!;

    filter.catch(new ZodValidationException(zodError), host);

    expect(status).toHaveBeenCalledWith(400);
    const body = sentBody(json);
    expect(body.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    const details = body.error.details as { path: string; message: string }[];
    expect(Array.isArray(details)).toBe(true);
    expect(details[0]).toHaveProperty('path', 'url');
  });

  it('Error ทั่วไป → 500 INTERNAL_ERROR ไม่เผยข้อความจริง + log stack ฝั่ง server', () => {
    const { host, status, json } = mockHost();
    // 5xx ต้อง log stack ไว้ debug — spy ไว้ทั้งกัน console รก และยืนยันว่า log จริง
    const logSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    filter.catch(new Error('boom internal secret'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = sentBody(json);
    expect(body.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(body.error.message).not.toContain('secret');
    expect(logSpy).toHaveBeenCalledTimes(1);

    logSpy.mockRestore();
  });
});
