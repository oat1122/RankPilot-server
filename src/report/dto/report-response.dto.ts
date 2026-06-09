import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response shapes ของ /projects/:projectId/ahrefs/{site-report,report,report-status} —
 * รายงานเว็บเต็ม (apnth.com template). Zod ตัวเดียว document `data` ใน envelope ให้ TS client เห็น.
 */

/** POST site-report — api แค่ enqueue แล้วคืน jobId (เอกสาร 00 §4). */
export const reportEnqueuedSchema = z.object({
  jobId: z.string(),
  projectId: z.number(),
  status: z.literal('queued'),
});
export class ReportEnqueuedDto extends createZodDto(reportEnqueuedSchema) {}

/** สรุปผล site-report (job.returnvalue เมื่อ completed). */
export const siteReportSummarySchema = z.object({
  projectId: z.number(),
  domain: z.string(),
  domainRating: z.number().nullable(),
  backlinks: z.number().nullable(),
  registrar: z.string().nullable(),
  aiAnalyzed: z.boolean(),
  unitsSpent: z.number(),
});

/** GET report-status/:jobId — สถานะ job + สรุปผลเมื่อ state=completed. */
export const reportStatusSchema = z.object({
  jobId: z.string(),
  name: z.string(),
  state: z.string(),
  result: siteReportSummarySchema.nullable(),
  failedReason: z.string().nullable(),
});
export class ReportStatusDto extends createZodDto(reportStatusSchema) {}

/** คำแนะนำ SEO (AI) — null ถ้ายังไม่ generate/AI ล้ม. */
export const siteAnalysisSchema = z
  .object({
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    recommendations: z.array(z.string()),
    timeline: z.string(),
  })
  .nullable();

/** 1 keyword ที่เว็บ rank (ตาราง keyword ในรายงาน). */
export const reportKeywordSchema = z.object({
  keyword: z.string(),
  position: z.number().nullable(),
  volume: z.number().nullable(),
  difficulty: z.number().nullable(),
  traffic: z.number().nullable(),
});

/**
 * GET report — รายงานเว็บเต็ม (DB-read): WHOIS (registrar/age) + meta + metrics (DR/UR/BL/refdomains/
 * LW/SS/AI) + organic + competitors + keyword + analysis. ค่าที่ยังไม่มี = null → FE แสดง "—".
 */
export const siteReportSchema = z.object({
  domain: z.string(),
  registrar: z.string().nullable(),
  domainCreatedAt: z.string().nullable(), // ISO
  ageYears: z.number().nullable(),
  metaDescription: z.string().nullable(),
  metrics: z.object({
    domainRating: z.number().nullable(), // DR
    urlRating: z.number().nullable(), // UR ≈ TF
    backlinks: z.number().nullable(), // BL
    referringDomains: z.number().nullable(),
    refdomainsNew: z.number().nullable(), // LW won
    refdomainsLost: z.number().nullable(), // LW lost
    spamScore: z.number().nullable(), // SS (ประมาณการ)
    aiMentions: z.number().nullable(), // AI
    capturedAt: z.string().nullable(), // ISO ของ backlink snapshot
  }),
  organic: z.object({
    traffic: z.number(),
    value: z.number(),
    keywords: z.number(),
  }),
  competitors: z.array(z.string()),
  competitorsCount: z.number(),
  keywords: z.array(reportKeywordSchema),
  analysis: siteAnalysisSchema,
  generatedAt: z.string().nullable(), // ISO — null = ยังไม่เคย generate
});
export class SiteReportDto extends createZodDto(siteReportSchema) {}
