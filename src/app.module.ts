import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ZodValidationPipe } from 'nestjs-zod';
import { validateEnv } from './config/env';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    HealthModule,
  ],
  providers: [
    // validate ทุก request ที่ใช้ createZodDto ทั่วแอป (เอกสาร 04 §6)
    { provide: APP_PIPE, useClass: ZodValidationPipe },
  ],
})
export class AppModule {}
