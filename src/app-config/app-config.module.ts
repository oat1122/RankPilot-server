import { Module } from '@nestjs/common';
import { AppConfigController } from './app-config.controller';

// ConfigModule เป็น global (app.module.ts) → ConfigService inject ได้โดยไม่ต้อง import ที่นี่.
@Module({
  controllers: [AppConfigController],
})
export class AppConfigModule {}
