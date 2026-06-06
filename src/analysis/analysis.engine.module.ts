import { Module } from '@nestjs/common';
import { AnalysisRepo } from './analysis.repo';
import { AnalysisRunner } from './analysis.runner';

/**
 * Engine ของ stage [3] Analysis (shared) — provide AnalysisRunner (compute) + AnalysisRepo
 * โดยไม่มี controller/queue เพื่อให้ทั้ง worker (AnalysisProcessor) และ api (AnalysisModule
 * producer) import ใช้ซ้ำได้ ตามกฎ api ≠ worker (เทียบ AhrefsModule ของ flow enrich).
 * DB inject ผ่าน token @Global (DbModule) → ไม่ต้อง import เพิ่ม.
 */
@Module({
  providers: [AnalysisRepo, AnalysisRunner],
  exports: [AnalysisRepo, AnalysisRunner],
})
export class AnalysisEngineModule {}
