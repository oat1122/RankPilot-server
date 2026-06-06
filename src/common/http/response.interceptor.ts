import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ApiSuccessResponse, ok } from './api-response.schema';
import { buildMeta } from './http-meta';

/**
 * ห่อทุก response ที่ "สำเร็จ" เป็น envelope กลาง { success:true, data, meta } (เอกสาร 04 §6).
 *
 * controller คืน resource ดิบเหมือนเดิม — interceptor นี้เติม success/meta ให้อัตโนมัติ
 * จึงไม่ต้องไปแก้ทุก handler. error ไม่ผ่านที่นี่ (RxJS error channel) → ตกไปที่
 * AllExceptionsFilter ซึ่งห่อเป็น error envelope แทน.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccessResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    const req = context.switchToHttp().getRequest<{ id?: unknown }>();
    return next.handle().pipe(
      map((data) => {
        // กัน double-wrap เผื่อ handler คืน envelope มาเองแล้ว (เช่น proxy ผลจาก service อื่น)
        if (isEnvelope(data)) return data as unknown as ApiSuccessResponse<T>;
        return ok(data, buildMeta(req));
      }),
    );
  }
}

function isEnvelope(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    'success' in v &&
    typeof v.success === 'boolean'
  );
}
