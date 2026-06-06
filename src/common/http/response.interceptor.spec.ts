import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

/** ExecutionContext จำลองที่มี req.id (pino-http). */
function mockContext(reqId?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ id: reqId }),
    }),
  } as unknown as ExecutionContext;
}

function handlerOf(value: unknown): CallHandler {
  return { handle: () => of(value) } as CallHandler;
}

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor();

  it('ห่อ resource ดิบเป็น envelope success พร้อม meta', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(mockContext('req-1'), handlerOf({ foo: 'bar' })),
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ foo: 'bar' });
    expect(result.meta.requestId).toBe('req-1');
    expect(typeof result.meta.timestamp).toBe('string');
  });

  it('ไม่ใส่ requestId ถ้า req ไม่มี id', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(mockContext(undefined), handlerOf(123)),
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe(123);
    expect(result.meta.requestId).toBeUndefined();
  });

  it('ไม่ double-wrap ถ้า handler คืน envelope มาแล้ว', async () => {
    const envelope = {
      success: true,
      data: { already: 'wrapped' },
      meta: { timestamp: 'x' },
    };
    const result = await firstValueFrom(
      interceptor.intercept(mockContext('req-2'), handlerOf(envelope)),
    );

    expect(result).toBe(envelope);
  });
});
