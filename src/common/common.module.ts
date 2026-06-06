import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './http/all-exceptions.filter';
import { ResponseInterceptor } from './http/response.interceptor';

/**
 * ชั้นกลางการสื่อสาร FE↔BE (เอกสาร 04 §6) — ลงทะเบียนที่เดียว:
 *  - ResponseInterceptor (APP_INTERCEPTOR): ห่อ success → envelope
 *  - AllExceptionsFilter (APP_FILTER): แปลงทุก exception → error envelope
 *
 * import ใน AppModule (api) เท่านั้น — worker ไม่มี HTTP layer จึงไม่ต้องใช้.
 */
@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class CommonModule {}
