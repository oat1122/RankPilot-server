import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Response shapes ของ /projects/:projectId/ahrefs/* — Zod ตัวเดียว (เอกสาร 04 §6)
 * document `data` ใน envelope ให้ TS client ฝั่ง web เห็น type จริง.
 */

/** POST enrich — api แค่ enqueue แล้วคืน jobId (เอกสาร 00 §4). */
export const enrichEnqueuedSchema = z.object({
  jobId: z.string(),
  projectId: z.number(),
  status: z.literal('queued'),
});
export class EnrichEnqueuedDto extends createZodDto(enrichEnqueuedSchema) {}

/** สรุปผล enrich organic-keywords (job 'enrich-organic'). */
export const enrichSummarySchema = z.object({
  projectId: z.number(),
  domain: z.string(),
  fetched: z.number(),
  keywordsUpserted: z.number(),
  pageKeywordsInserted: z.number(),
  unitsSpent: z.number(),
  cached: z.boolean(),
});

/** สรุปผล keywords-explorer/overview (job 'enrich-keywords' — เอกสาร 03a §4.1). */
export const keywordOverviewSummarySchema = z.object({
  projectId: z.number(),
  country: z.string(),
  requested: z.number(),
  fetched: z.number(),
  keywordsUpserted: z.number(),
  unitsSpent: z.number(),
  cached: z.boolean(),
});

/** 1 หน้าใน top-pages selection. */
export const topPageSchema = z.object({
  url: z.string(),
  traffic: z.number().nullable(),
  topKeyword: z.string().nullable(),
});

/** สรุปผล top-pages (job 'top-pages' — เอกสาร 03a §4.2): selection top 20% by traffic. */
export const topPagesSummarySchema = z.object({
  projectId: z.number(),
  domain: z.string(),
  fetched: z.number(),
  topCount: z.number(),
  topPages: z.array(topPageSchema),
  unitsSpent: z.number(),
  cached: z.boolean(),
});

/** สรุปผล organic-competitors (job 'competitors' — เอกสาร 03a §4.3). */
export const competitorsSummarySchema = z.object({
  projectId: z.number(),
  domain: z.string(),
  fetched: z.number(),
  competitorsUpserted: z.number(),
  unitsSpent: z.number(),
  cached: z.boolean(),
});

/** สรุปผล serp-overview (job 'serp-overview' — เอกสาร 03a §5). */
export const serpOverviewSummarySchema = z.object({
  projectId: z.number(),
  keyword: z.string(),
  fetched: z.number(),
  serpInserted: z.number(),
  unitsSpent: z.number(),
  cached: z.boolean(),
});

/** สรุปผล keyword ideas (job 'keyword-ideas' — เอกสาร 03a §5). */
export const keywordIdeasSummarySchema = z.object({
  projectId: z.number(),
  seed: z.string(),
  mode: z.enum(['matching', 'related']),
  fetched: z.number(),
  gapsInserted: z.number(),
  unitsSpent: z.number(),
  cached: z.boolean(),
});

/** สรุปผล backlinks (job 'backlinks' — เอกสาร 03a §6). */
export const backlinksSummarySchema = z.object({
  projectId: z.number(),
  domain: z.string(),
  domainRating: z.number().nullable(),
  urlRating: z.number().nullable(),
  referringDomains: z.number().nullable(),
  unitsSpent: z.number(),
  cached: z.boolean(),
});

/** GET enrich/:jobId — สถานะ job + สรุปผลเมื่อ state=completed (result แยกชนิดด้วย name). */
export const enrichStatusSchema = z.object({
  jobId: z.string(),
  // job.name: enrich-organic | enrich-keywords | top-pages | competitors | serp-overview | keyword-ideas | backlinks
  name: z.string(),
  // BullMQ JobState: waiting | active | completed | failed | delayed | ...
  state: z.string(),
  result: z
    .union([
      enrichSummarySchema,
      keywordOverviewSummarySchema,
      topPagesSummarySchema,
      competitorsSummarySchema,
      serpOverviewSummarySchema,
      keywordIdeasSummarySchema,
      backlinksSummarySchema,
    ])
    .nullable(),
  failedReason: z.string().nullable(),
});
export class EnrichStatusDto extends createZodDto(enrichStatusSchema) {}

/** GET budget — งบ units เดือนปัจจุบัน (Redis counter + เพดานโปรเจค). */
export const ahrefsBudgetSchema = z.object({
  projectId: z.number(),
  period: z.string(), // 'YYYY-MM'
  unitsSpent: z.number(),
  cap: z.number(),
  remaining: z.number(),
});
export class AhrefsBudgetDto extends createZodDto(ahrefsBudgetSchema) {}
