import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response shapes ของ /projects/:projectId/analysis/* — Zod ตัวเดียว (เอกสาร 04 §6)
 * document `data` ใน envelope ให้ TS client ฝั่ง web เห็น type จริง.
 */

/** POST analysis — api แค่ enqueue แล้วคืน jobId (เอกสาร 00 §4). */
export const analysisEnqueuedSchema = z.object({
  jobId: z.string(),
  projectId: z.number(),
  status: z.literal('queued'),
});
export class AnalysisEnqueuedDto extends createZodDto(analysisEnqueuedSchema) {}

/** สรุปผล analyze-crawl (= job.returnvalue เมื่อ completed). */
export const analysisSummarySchema = z.object({
  projectId: z.number(),
  crawlId: z.number(),
  pagesAnalyzed: z.number(),
  pagesWithRanking: z.number(), // หน้าที่มี ranking signal สดจาก flow [2] (0 = handoff ขาด)
  scoresUpserted: z.number(),
  findingsCreated: z.number(),
  byType: z.record(z.string(), z.number()),
});

/** GET jobs/:jobId — สถานะ job + สรุปเมื่อ state=completed. */
export const analysisStatusSchema = z.object({
  jobId: z.string(),
  name: z.string(), // 'analyze-crawl'
  state: z.string(), // waiting | active | completed | failed | delayed
  result: analysisSummarySchema.nullable(),
  failedReason: z.string().nullable(),
});
export class AnalysisStatusDto extends createZodDto(analysisStatusSchema) {}

/** 1 finding (audit_findings) join page url — สำหรับ Action Dashboard (เอกสาร 04 §7). */
export const analysisFindingSchema = z.object({
  id: z.number(),
  pageId: z.number().nullable(),
  url: z.string().nullable(),
  crawlId: z.number().nullable(),
  type: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  impactScore: z.number(),
  status: z.string(),
  details: z.unknown(),
  detectedAt: z.coerce.string(),
});

/** GET findings — list + total สำหรับ pagination. */
export const analysisFindingsSchema = z.object({
  items: z.array(analysisFindingSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export class AnalysisFindingsDto extends createZodDto(analysisFindingsSchema) {}

/** 1 seo_score ต่อ snapshot join page url. */
export const analysisScoreSchema = z.object({
  snapshotId: z.number(),
  pageId: z.number(),
  url: z.string(),
  keywordCoverage: z.number().nullable(),
  healthScore: z.number().nullable(),
  breakdown: z.unknown(),
});

/** GET scores — list ของ crawl ที่เลือก/ล่าสุด. */
export const analysisScoresSchema = z.object({
  items: z.array(analysisScoreSchema),
});
export class AnalysisScoresDto extends createZodDto(analysisScoresSchema) {}
