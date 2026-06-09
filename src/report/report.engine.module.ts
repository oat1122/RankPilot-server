import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AhrefsModule } from '../ahrefs/ahrefs.module';
import { AiEngineModule } from '../ai/ai.engine.module';
import { WhoisService } from './whois.service';
import { SiteReportRepo } from './site-report.repo';
import { SiteReportRunner } from './site-report.runner';

/**
 * Engine ของรายงานเว็บเต็ม (shared) — provide WhoisService + SiteReportRepo + SiteReportRunner
 * (orchestrator) โดยไม่มี controller/queue เพื่อให้ทั้ง worker (ReportProcessor) และ api
 * (ReportModule producer) import ใช้ซ้ำได้ตามกฎ api ≠ worker. imports:
 *   - HttpModule → WhoisService (RDAP ผ่าน axios)
 *   - AhrefsModule → EnrichmentService (enrich) + AhrefsRepo (อ่าน metric)
 *   - AiEngineModule → AiConfigRepo (model/skills ต่อโปรเจค สำหรับ AI analysis)
 */
@Module({
  imports: [HttpModule, AhrefsModule, AiEngineModule],
  providers: [WhoisService, SiteReportRepo, SiteReportRunner],
  exports: [SiteReportRunner, SiteReportRepo],
})
export class ReportEngineModule {}
