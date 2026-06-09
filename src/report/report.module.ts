import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AhrefsModule } from '../ahrefs/ahrefs.module';
import { ReportEngineModule } from './report.engine.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

/**
 * Domain 'report' ฝั่ง api (producer) — register queue 'report' + controller รายงานเว็บเต็ม.
 * import AhrefsModule (AhrefsRepo: โหลด project + อ่าน metric core) + ReportEngineModule
 * (SiteReportRepo: อ่าน site_reports). การ orchestrate จริง (Ahrefs/WHOIS/AI) อยู่ใน worker
 * (ReportProcessor) ตามกฎ api ≠ worker. attempts=1 ∵ งานแพง (units+AI) ไม่ควร auto-retry.
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'report',
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
    AhrefsModule,
    ReportEngineModule,
  ],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
